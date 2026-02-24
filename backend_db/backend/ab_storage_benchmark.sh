#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Apache Bench (ab) Storage Benchmark Script
# ═══════════════════════════════════════════════════════════════════════════════
#
# This script focuses exclusively on testing file upload and download performance.
# It skips general API tests to provide rapid feedback on storage efficiency.
#
# Usage:
#   ./ab_storage_benchmark.sh                    # Default: 100 reqs, 10 concurrent
#   ./ab_storage_benchmark.sh -n 1000 -c 50      # Stress test
#
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# ─────────────────────────────────────────────────────────────────────────────
# Load Environment Variables
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env"

if [ -f "$ENV_FILE" ]; then
    while IFS='=' read -r key value || [ -n "$key" ]; do
        [[ $key =~ ^#.*$ ]] && continue
        [[ -z $key ]] && continue
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | xargs | sed 's/^["'"'"']//;s/["'"'"']$//')
        if [ -z "${!key}" ]; then
            export "$key=$value"
        fi
    done < "$ENV_FILE"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

HOST="${HOST:-http://127.0.0.1:${BACKEND_PORT:-8000}}"
if [ -z "$API_KEY" ]; then
    echo "❌ API_KEY not found in .env file. Please set it."
    exit 1
fi

TOTAL_REQUESTS="${TOTAL_REQUESTS:-100}"
CONCURRENCY="${CONCURRENCY:-10}"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")

# Test user credentials
TEST_EMAIL="storage_ab_${TIMESTAMP}@example.com"
TEST_PASSWORD="StorageTest123!"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Results arrays
declare -a TEST_NAMES
declare -a TEST_RPS
declare -a TEST_LATENCY
declare -a TEST_FAILED
declare -a TEST_THROUGHPUT  # MB/s per endpoint

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

print_header() {
    echo -e "\n${CYAN}══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}══════════════════════════════════════════════════════════════════${NC}\n"
}

print_subheader() {
    echo -e "\n${BLUE}──────────────────────────────────────────────────────────────────${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}──────────────────────────────────────────────────────────────────${NC}\n"
}

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }

check_dependencies() {
    if ! command -v ab &> /dev/null; then
        print_error "Apache Bench (ab) is not installed!"
        exit 1
    fi
    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed!"
        exit 1
    fi
    if ! command -v jq &> /dev/null; then
        JQ_AVAILABLE=false
    else
        JQ_AVAILABLE=true
    fi
}

check_api_health() {
    print_subheader "Checking API Health"
    response=$(curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: ${API_KEY}" "${HOST}/storage/files/stats" 2>/dev/null || echo "000")
    if [ "$response" == "200" ]; then
        print_success "API is responding at ${HOST}"
    else
        print_error "API is not responding (HTTP $response). Is server running?"
        exit 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────────────────────────────────────

setup_test_user() {
    print_subheader "Setting Up Test User"
    
    # Create user
    create_resp=$(curl -s -X POST "${HOST}/users/" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -d "{ \"email\": \"${TEST_EMAIL}\", \"password\": \"${TEST_PASSWORD}\", \"firstName\": \"Storage\", \"lastName\": \"Test\" }" 2>/dev/null)
    
    if $JQ_AVAILABLE; then
        CREATED_USER_ID=$(echo "$create_resp" | jq -r '.id // empty')
    else
        CREATED_USER_ID=$(echo "$create_resp" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    fi
    
    if [ -n "$CREATED_USER_ID" ]; then
        print_success "Created test user: ${TEST_EMAIL}"
    else
        print_error "Failed to create user"
        echo "$create_resp"
        exit 1
    fi
    
    # Login
    login_resp=$(curl -s -X POST "${HOST}/users/token" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -d "{ \"email\": \"${TEST_EMAIL}\", \"password\": \"${TEST_PASSWORD}\" }" 2>/dev/null)
        
    if $JQ_AVAILABLE; then
        ACCESS_TOKEN=$(echo "$login_resp" | jq -r '.access_token // empty')
    else
        ACCESS_TOKEN=$(echo "$login_resp" | grep -oE '"access_token":"[^"]+' | cut -d'"' -f4)
    fi
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "Login failed"
        exit 1
    fi
    print_success "Obtained access token"
}

setup_test_bucket() {
    print_subheader "Setting Up Test Bucket"
    
    BUCKET_NAME="abstorage-$(date +%s)"
    
    create_resp=$(curl -s -X POST "${HOST}/storage/buckets/" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -d "{ \"name\": \"${BUCKET_NAME}\", \"public\": true, \"description\": \"Storage benchmark bucket\" }" 2>/dev/null)
        
    if $JQ_AVAILABLE; then
        CREATED_BUCKET_ID=$(echo "$create_resp" | jq -r '.id // empty')
    else
        CREATED_BUCKET_ID=$(echo "$create_resp" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    fi
    
    if [ -n "$CREATED_BUCKET_ID" ]; then
        print_success "Created bucket: ${BUCKET_NAME}"
    else
        print_error "Failed to create bucket"
        echo "$create_resp"
        exit 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Benchmarks
# ─────────────────────────────────────────────────────────────────────────────

run_upload_download_benchmarks() {
    print_header "Running Storage Benchmarks (Upload & Download)"
    
    # 1. Prepare Test File
    # --------------------
    TEST_FILES_DIR="${SCRIPT_DIR}/../storage/benchmarks/test-files"
    local test_file=""
    local test_file_name=""
    local test_file_size=0
    
    if [ -d "$TEST_FILES_DIR" ]; then
        for f in "$TEST_FILES_DIR"/*; do
            if [ -f "$f" ]; then
                local size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
                # Pick valid file < 10MB
                if [ "$size" -lt 10485760 ]; then
                    test_file="$f"
                    test_file_name=$(basename "$f")
                    test_file_size=$size
                    break
                fi
            fi
        done
    fi
    
    if [ -z "$test_file" ]; then
        print_info "Creating sample 100KB test file"
        test_file=$(mktemp)
        dd if=/dev/urandom of="$test_file" bs=1024 count=100 2>/dev/null
        test_file_name="sample_100k.bin"
        test_file_size=102400
        local created_sample=true
    else
        print_info "Using existing test file: $test_file_name ($((test_file_size/1024)) KB)"
    fi
    
    local size_kb=$((test_file_size / 1024))
    
    # 2. Upload Benchmark
    # -------------------
    # We use curl with parallel processes to stream raw file data
    # The new streaming API accepts query params for metadata and raw body for file content
    
    echo -e "${YELLOW}Testing: file_upload${NC}"
    echo "  Method: POST (streaming)"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    local success_count=0
    local fail_count=0
    local start_time=$(date +%s%N)
    
    # URL encode the filename for query parameter
    local encoded_filename=$(printf '%s' "$test_file_name" | sed 's/ /%20/g; s/!/%21/g; s/"/%22/g; s/#/%23/g; s/\$/%24/g; s/\&/%26/g; s/'\''/%27/g; s/(/%28/g; s/)/%29/g; s/\*/%2A/g; s/+/%2B/g; s/,/%2C/g')
    
    # Run batches
    for ((i=0; i<TOTAL_REQUESTS; i+=CONCURRENCY)); do
        local batch_pids=()
        for ((j=0; j<CONCURRENCY && (i+j)<TOTAL_REQUESTS; j++)); do
            (
                local upload_path="bench_up_${i}_${j}_${test_file_name}"
                local encoded_path=$(printf '%s' "$upload_path" | sed 's/ /%20/g; s/!/%21/g; s/"/%22/g; s/#/%23/g; s/\$/%24/g; s/\&/%26/g; s/'\''/%27/g; s/(/%28/g; s/)/%29/g; s/\*/%2A/g; s/+/%2B/g; s/,/%2C/g')
                local resp=$(curl -s -w "%{http_code}" -o /dev/null \
                    -X POST "${HOST}/storage/files/upload?bucket_id=${CREATED_BUCKET_ID}&path=${encoded_path}&filename=${encoded_filename}&content_type=application/octet-stream" \
                    -H "X-API-Key: ${API_KEY}" \
                    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
                    -H "Content-Type: application/octet-stream" \
                    -H "Content-Length: ${test_file_size}" \
                    --data-binary "@${test_file}" 2>/dev/null)
                
                if [ "$resp" == "201" ] || [ "$resp" == "200" ]; then
                    exit 0
                else
                    exit 1
                fi
            ) &
            batch_pids+=($!)
        done
        
        for pid in "${batch_pids[@]}"; do
            if wait $pid; then
                ((success_count++))
            else
                ((fail_count++))
            fi
        done
    done
    
    local end_time=$(date +%s%N)
    local duration_ms=$(( (end_time - start_time) / 1000000 ))
    local duration_sec=$(echo "scale=3; $duration_ms / 1000" | bc)
    local rps=$(echo "scale=2; $TOTAL_REQUESTS / ($duration_sec + 0.001)" | bc)
    local latency_ms=$(echo "scale=3; $duration_ms / $TOTAL_REQUESTS" | bc)
    
    local throughput_mb_s=$(echo "scale=2; ($rps * $test_file_size) / 1048576" | bc)

    TEST_NAMES+=("file_upload")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("${latency_ms} [ms]")
    TEST_FAILED+=("$fail_count")
    TEST_THROUGHPUT+=("${throughput_mb_s} MB/s")
    
    if [ "$fail_count" == "0" ]; then
        print_success "file_upload: ${rps} req/sec, ${latency_ms} [ms]"
    else
        print_error "file_upload: ${rps} req/sec, ${latency_ms} [ms] ($fail_count failed)"
    fi
    
    # 3. Download Benchmark
    # ---------------------
    # We use `ab` for downloads as it handles GET requests very well
    
    # Use one of the files we just uploaded
    local target_dl_path="bench_up_0_0_${test_file_name}"
    
    echo -e "\n${YELLOW}Testing: file_download${NC}"
    echo "  Method: GET"
    echo "  URL: ${HOST}/storage/files/download/${BUCKET_NAME}/${target_dl_path}"
    
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY -q"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Authorization: Bearer ${ACCESS_TOKEN}'"
    ab_cmd+=" '${HOST}/storage/files/download/${BUCKET_NAME}/${target_dl_path}'"
    
    local output=$(eval $ab_cmd 2>&1)
    
    local dl_rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local dl_lat=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local dl_fail=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    local dl_throughput_mb_s=$(echo "scale=2; ($dl_rps * $test_file_size) / 1048576" | bc)

    TEST_NAMES+=("file_download")
    TEST_RPS+=("$dl_rps")
    TEST_LATENCY+=("$dl_lat")
    TEST_FAILED+=("${dl_fail:-0}")
    TEST_THROUGHPUT+=("${dl_throughput_mb_s} MB/s")
    
    if [ "${dl_fail:-0}" == "0" ]; then
        print_success "file_download: ${dl_rps} req/sec"
    else
        print_error "file_download: ${dl_rps} req/sec (${dl_fail} failed)"
    fi
    
    # Cleanup sample file without breaking set -e
    if [ "${created_sample:-false}" == "true" ]; then
        rm -f "$test_file"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Summary & Cleanup
# ─────────────────────────────────────────────────────────────────────────────

generate_summary() {
    print_header "Benchmark Summary"
    
    # Display summary table in terminal
    echo ""
    echo -e "${CYAN}┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│                                  STORAGE BENCHMARK RESULTS                                                  │${NC}"
    echo -e "${CYAN}├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤${NC}"
    printf "${CYAN}│${NC} %-25s ${CYAN}│${NC} %10s ${CYAN}│${NC} %14s ${CYAN}│${NC} %12s ${CYAN}│${NC} %8s ${CYAN}│${NC} %10s ${CYAN}│${NC}\n" \
        "ENDPOINT" "REQ/SEC" "LATENCY" "THROUGHPUT" "FAILED" "STATUS"
    echo -e "${CYAN}├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤${NC}"
    
    local fastest_rps=0
    local fastest_name=""
    local slowest_rps=999999
    local slowest_name=""
    local total_rps=0
    local count=${#TEST_NAMES[@]}
    
    for i in "${!TEST_NAMES[@]}"; do
        local name="${TEST_NAMES[$i]}"
        local rps="${TEST_RPS[$i]}"
        local latency="${TEST_LATENCY[$i]}"
        local failed="${TEST_FAILED[$i]}"
        
        # Determine status
        if [ "${failed:-0}" == "0" ]; then
            status="${GREEN}✓ PASS${NC}"
        else
            status="${RED}✗ FAIL${NC}"
        fi
        
        # Truncate name if too long
        local display_name="$name"
        if [ ${#display_name} -gt 23 ]; then
            display_name="${display_name:0:20}..."
        fi
        
        local throughput="${TEST_THROUGHPUT[$i]}"
        printf "${CYAN}│${NC} %-25s ${CYAN}│${NC} %10s ${CYAN}│${NC} %14s ${CYAN}│${NC} %12s ${CYAN}│${NC} %8s ${CYAN}│${NC} %b ${CYAN}│${NC}\n" \
            "$display_name" "$rps" "$latency" "$throughput" "$failed" "$status"
        
        # Track fastest/slowest for highlights (integer part of rps)
        local rps_int=$(echo "$rps" | cut -d'.' -f1)
        if [ -n "$rps_int" ] && [ "$rps_int" != "" ]; then
            total_rps=$((total_rps + rps_int))
            if [ "$rps_int" -gt "$fastest_rps" ]; then
                fastest_rps=$rps_int
                fastest_name=$name
            fi
            if [ "$rps_int" -lt "$slowest_rps" ]; then
                slowest_rps=$rps_int
                slowest_name=$name
            fi
        fi
    done
    
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    # Performance highlights
    echo -e "${CYAN}┌─────────────────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│                              PERFORMANCE HIGHLIGHTS                                    │${NC}"
    echo -e "${CYAN}├─────────────────────────────────────────────────────────────────────────────────────────┤${NC}"
    
    if [ $count -gt 0 ]; then
        local avg_rps=$((total_rps / count))
        printf "${CYAN}│${NC}  ${GREEN}🚀 Fastest:${NC} %-25s (%d req/sec)                                 ${CYAN}│${NC}\n" "$fastest_name" "$fastest_rps"
        printf "${CYAN}│${NC}  ${YELLOW}🐢 Slowest:${NC} %-25s (%d req/sec)                                 ${CYAN}│${NC}\n" "$slowest_name" "$slowest_rps"
        printf "${CYAN}│${NC}  ${BLUE}📊 Average:${NC} %d req/sec across %d endpoints                                      ${CYAN}│${NC}\n" "$avg_rps" "$count"
    fi
    
    echo -e "${CYAN}└─────────────────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    # Test configuration
    echo -e "${BLUE}Test Configuration:${NC}"
    echo "  Host: ${HOST}"
    echo "  Requests per test: ${TOTAL_REQUESTS}"
    echo "  Concurrency: ${CONCURRENCY}"
}

cleanup() {
    print_subheader "Cleaning Up"
    
    # Delete bucket (auto-deletes files)
    if [ -n "$CREATED_BUCKET_ID" ]; then
        curl -s -X DELETE "${HOST}/storage/buckets/${CREATED_BUCKET_ID}" \
            -H "X-API-Key: ${API_KEY}" -H "Authorization: Bearer ${ACCESS_TOKEN}" >/dev/null
        print_success "Deleted bucket: $BUCKET_NAME"
    fi
    
    # Delete user (need admin token)
    # Using simple admin auth for cleanup
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-password}"
    
    admin_token_resp=$(curl -s -X POST "${HOST}/users/token" \
        -d "{ \"email\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASSWORD\" }" \
        -H "Content-Type: application/json" -H "X-API-Key: ${API_KEY}" 2>/dev/null)
        
    admin_token=$(echo "$admin_token_resp" | grep -oE '"access_token":"[^"]+' | cut -d'"' -f4)
    
    if [ -n "$admin_token" ] && [ -n "$CREATED_USER_ID" ]; then
        curl -s -X DELETE "${HOST}/users/${CREATED_USER_ID}" \
            -H "X-API-Key: ${API_KEY}" -H "Authorization: Bearer ${admin_token}" >/dev/null
        print_success "Deleted test user: $TEST_EMAIL"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--requests) TOTAL_REQUESTS="$2"; shift 2 ;;
        -c|--concurrency) CONCURRENCY="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

check_dependencies
check_api_health
setup_test_user
setup_test_bucket
run_upload_download_benchmarks
set +e  # Allow summary to run even if a prior command returned non-zero
generate_summary
cleanup
