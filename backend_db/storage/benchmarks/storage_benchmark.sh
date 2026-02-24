#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
# Storage Service Benchmark Script
# ═══════════════════════════════════════════════════════════════════════════════
#
# Benchmarks storage service upload/download performance using curl timing.
# - Iterates files under test-files/
# - Creates a benchmark bucket
# - Uploads and downloads each file
# - Prints file size, upload speed, download TTFB, total time, and secs/GB
#
# Usage:
#   ./storage_benchmark.sh                    # Run with defaults
#   ./storage_benchmark.sh my-bucket          # Use custom bucket name
#   API_URL=http://192.168.1.100:8000 ./storage_benchmark.sh  # Custom host
#
# Prerequisites:
#   - Run ./generate_test_files.sh first to create test files
#
# ═══════════════════════════════════════════════════════════════════════════════

API_URL=${API_URL:-http://localhost:8000}
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# Bucket name (must match pattern: ^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$)
BUCKET=${1:-bench-$(date +%Y%m%d%H%M%S)}
RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)

# Temp directory to persist downloaded bytes (simulate browser disk writes)
TMP_DIR=${TMP_DIR:-/tmp/selfdb-bench/$RUN_ID}
mkdir -p "$TMP_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

size_of() {
  local f="$1"
  if stat -f%z "$f" >/dev/null 2>&1; then
    stat -f%z "$f"
  else
    wc -c < "$f"
  fi
}

# URL-encode a path component (RFC 3986)
urlencode() {
  local raw="$1"
  local length="${#raw}"
  local i c
  for (( i = 0; i < length; i++ )); do
    c="${raw:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) printf '%s' "$c" ;;
      *) printf '%%%02X' "'$c" ;;
    esac
  done
}

human_bytes() {
  awk -v b="$1" 'function f(x){return (x<1024)?sprintf("%d B",x):(x<1048576)?sprintf("%.1f KB",x/1024):(x<1073741824)?sprintf("%.1f MB",x/1048576):sprintf("%.2f GB",x/1073741824)} BEGIN{print f(b)}'
}

secs_per_gb() {
  awk -v t="$1" -v s="$2" 'BEGIN{gb=s/1073741824; if(gb>0) printf("%.3f", t/gb); else print "-"}'
}

# ─────────────────────────────────────────────────────────────────────────────
# API Functions
# ─────────────────────────────────────────────────────────────────────────────

create_bucket() {
  curl -sS -X POST \
    "$API_URL/api/v1/buckets" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$BUCKET\",\"public\":false}" \
    >/dev/null 2>&1 || true
}

delete_bucket() {
  curl -sS -X DELETE \
    "$API_URL/api/v1/buckets/$BUCKET" \
    >/dev/null 2>&1 || true
}

bench_upload() {
  local f="$1"
  local rel="${f#test-files/}"
  # URL-encode the path for files with spaces/special chars
  local enc_path
  enc_path="$(urlencode "bench/$RUN_ID/$rel")"
  
  # Upload file and capture timing metrics
  # Output format: http_code time_total speed_upload
  curl -sS -o /dev/null -w "%{http_code} %{time_total} %{speed_upload}" \
    -F "file=@$f" \
    "$API_URL/api/v1/files/$BUCKET/$enc_path"
}

bench_download() {
  local rel="$1"
  local path="bench/$RUN_ID/$rel"
  local enc_path
  enc_path="$(urlencode "$path")"
  local url="$API_URL/api/v1/files/$BUCKET/$enc_path"
  
  # Full download metrics (write to disk to match browser behavior)
  local outfile="$TMP_DIR/${rel//\//_}"
  
  # Output format: http_code time_starttransfer time_total speed_download
  curl -sS -o "$outfile" -w "%{http_code} %{time_starttransfer} %{time_total} %{speed_download}" \
    "$url"
  
  # Remove downloaded file after timing is measured
  rm -f "$outfile" 2>/dev/null || true
}

delete_file() {
  local path="$1"
  local enc_path
  enc_path="$(urlencode "$path")"
  curl -sS -X DELETE -o /dev/null \
    "$API_URL/api/v1/files/$BUCKET/$enc_path" 2>/dev/null || true
}

# ─────────────────────────────────────────────────────────────────────────────
# Main Script
# ─────────────────────────────────────────────────────────────────────────────

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  📦 Storage Service Benchmark${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  API_URL:  ${GREEN}$API_URL${NC}"
echo -e "  BUCKET:   ${GREEN}$BUCKET${NC}"
echo -e "  RUN_ID:   ${GREEN}$RUN_ID${NC}"
echo ""

# Check for test files
if [ ! -d "test-files" ]; then
  echo -e "${RED}✗ test-files directory not found in $PROJECT_ROOT${NC}" >&2
  echo "  Run ./generate_test_files.sh first!"
  exit 1
fi

FILE_COUNT=$(find test-files -type f | wc -l | tr -d ' ')
echo -e "${GREEN}✓${NC} Found ${FILE_COUNT} test files"
echo ""

# Check API health
echo -n "Checking API health... "
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" 2>/dev/null || echo "000")
if [ "$HEALTH_CODE" == "200" ]; then
  echo -e "${GREEN}✓ OK${NC}"
else
  echo -e "${RED}✗ FAILED (HTTP $HEALTH_CODE)${NC}"
  echo "  Make sure the storage service is running at $API_URL"
  exit 1
fi

# Create bucket
echo -n "Creating bucket: $BUCKET... "
create_bucket
echo -e "${GREEN}✓${NC}"
echo ""

# Print table header
echo -e "${CYAN}Running benchmark...${NC}"
echo ""
printf "${BLUE}%-35s  %10s  %12s  %10s  %10s  %12s  %12s${NC}\n" \
  "FILE" "SIZE" "UP SPEED" "DL TTFB" "DL TOTAL" "UP s/GB" "DL s/GB"
printf "${BLUE}%-35s  %10s  %12s  %10s  %10s  %12s  %12s${NC}\n" \
  "-----------------------------------" "----------" "------------" "----------" "----------" "------------" "------------"

# Track uploaded files for cleanup
UPLOADED_LIST=$(mktemp)
TOTAL_BYTES=0
TOTAL_UP_TIME=0
TOTAL_DL_TIME=0
FILE_PROCESSED=0

# Process each file
while IFS= read -r -d '' f; do
  rel="${f#test-files/}"
  size_bytes=$(size_of "$f")
  
  # Upload (URL encoding happens in bench_upload)
  up_metrics=$(bench_upload "$f")
  up_code=$(echo "$up_metrics" | awk '{print $1}')
  up_total=$(echo "$up_metrics" | awk '{print $2}')
  up_speed=$(echo "$up_metrics" | awk '{print $3}')
  
  # Track uploaded path for cleanup (encoded)
  echo "bench/$RUN_ID/$rel" >> "$UPLOADED_LIST"
  
  # Download
  dl_full=$(bench_download "$rel")
  dl_code=$(echo "$dl_full" | awk '{print $1}')
  dl_ttfb=$(echo "$dl_full" | awk '{print $2}')
  dl_total=$(echo "$dl_full" | awk '{print $3}')
  dl_speed=$(echo "$dl_full" | awk '{print $4}')
  
  # Calculate secs/GB
  up_s_per_gb=$(secs_per_gb "$up_total" "$size_bytes")
  dl_s_per_gb=$(secs_per_gb "$dl_total" "$size_bytes")
  
  # Format upload speed
  up_speed_formatted=$(awk -v s="$up_speed" 'BEGIN{printf "%.2f MB/s", s/1048576}')
  
  # Status indicator
  if [ "$up_code" == "201" ] || [ "$up_code" == "200" ]; then
    status="${GREEN}✓${NC}"
  else
    status="${RED}✗${NC}"
  fi
  
  # Print row
  printf "%-35s  %10s  %12s  %9.3fs  %9.3fs  %12s  %12s %b\n" \
    "$rel" \
    "$(human_bytes "$size_bytes")" \
    "$up_speed_formatted" \
    "$dl_ttfb" \
    "$dl_total" \
    "$up_s_per_gb" \
    "$dl_s_per_gb" \
    "$status"
  
  # Accumulate totals
  TOTAL_BYTES=$((TOTAL_BYTES + size_bytes))
  TOTAL_UP_TIME=$(awk "BEGIN {print $TOTAL_UP_TIME + $up_total}")
  TOTAL_DL_TIME=$(awk "BEGIN {print $TOTAL_DL_TIME + $dl_total}")
  FILE_PROCESSED=$((FILE_PROCESSED + 1))
  
done < <(find test-files -type f -print0 | sort -z)

echo ""
echo -e "${CYAN}───────────────────────────────────────────────────────────────────${NC}"

# Calculate summary stats
if [ $FILE_PROCESSED -gt 0 ]; then
  AVG_UP_SPEED=$(awk "BEGIN {printf \"%.2f\", ($TOTAL_BYTES / $TOTAL_UP_TIME) / 1048576}")
  AVG_DL_SPEED=$(awk "BEGIN {printf \"%.2f\", ($TOTAL_BYTES / $TOTAL_DL_TIME) / 1048576}")
  
  echo ""
  echo -e "${CYAN}Summary:${NC}"
  echo -e "  Files processed:    ${GREEN}$FILE_PROCESSED${NC}"
  echo -e "  Total data:         ${GREEN}$(human_bytes $TOTAL_BYTES)${NC}"
  echo -e "  Total upload time:  ${GREEN}${TOTAL_UP_TIME}s${NC}"
  echo -e "  Total download time: ${GREEN}${TOTAL_DL_TIME}s${NC}"
  echo -e "  Avg upload speed:   ${GREEN}${AVG_UP_SPEED} MB/s${NC}"
  echo -e "  Avg download speed: ${GREEN}${AVG_DL_SPEED} MB/s${NC}"
fi

# Cleanup
echo ""
echo -n "🧹 Cleaning up uploaded files... "
while IFS= read -r p; do
  delete_file "$p"
done < "$UPLOADED_LIST"
rm -f "$UPLOADED_LIST"
echo -e "${GREEN}✓${NC}"

echo -n "🧹 Deleting bucket: $BUCKET... "
delete_bucket
echo -e "${GREEN}✓${NC}"

# Cleanup temp directory
rm -rf "$TMP_DIR" 2>/dev/null || true

echo ""
echo -e "${GREEN}✓ Benchmark complete!${NC}"
exit 0
