#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Apache Bench (ab) Load Testing Script for Day-One Backend API
# ═══════════════════════════════════════════════════════════════════════════════
#
# This script performs load testing using Apache Bench (ab) for the FastAPI backend.
# It tests various endpoints including Users and Tables APIs.
#
# Prerequisites:
#   - Apache Bench installed (comes with Apache HTTP Server)
#     macOS: Already installed (httpd is built-in)
#     Linux: sudo apt-get install apache2-utils
#
# Usage:
#   ./ab_benchmark.sh                    # Run with defaults (100 requests, 10 concurrent)
#   ./ab_benchmark.sh -n 1000 -c 50      # 1000 requests, 50 concurrent connections
#   ./ab_benchmark.sh --no-storage       # Skip all storage-related setup/tests
#   ./ab_benchmark.sh --help             # Show help message
#
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# ─────────────────────────────────────────────────────────────────────────────
# Load Environment Variables from .env file
# ─────────────────────────────────────────────────────────────────────────────

# Determine script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env"

# Load .env file if it exists
if [ -f "$ENV_FILE" ]; then
    # Export variables from .env file (ignore comments and empty lines)
    while IFS='=' read -r key value || [ -n "$key" ]; do
        # Skip comments and empty lines
        [[ $key =~ ^#.*$ ]] && continue
        [[ -z $key ]] && continue
        # Remove leading/trailing whitespace
        key=$(echo "$key" | xargs)
        # Remove surrounding quotes from value
        value=$(echo "$value" | xargs | sed 's/^["'"'"']//;s/["'"'"']$//')
        # Only set if not already set in environment
        if [ -z "${!key}" ]; then
            export "$key=$value"
        fi
    done < "$ENV_FILE"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

# NOTE: Use 127.0.0.1 instead of localhost on macOS to avoid
# "apr_socket_connect(): Invalid argument (22)" errors with ab
HOST="${HOST:-http://127.0.0.1:${BACKEND_PORT:-8000}}"
if [ -z "$API_KEY" ]; then
    echo "❌ API_KEY not found in .env file. Please set it."
    exit 1
fi
TOTAL_REQUESTS="${TOTAL_REQUESTS:-100}"
CONCURRENCY="${CONCURRENCY:-10}"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
RUN_STORAGE=true

# Admin credentials from .env (for function/webhook management)
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-password}"

# Arrays to store results for summary
declare -a TEST_NAMES
declare -a TEST_RPS
declare -a TEST_LATENCY
declare -a TEST_FAILED

# Test user credentials (will be created during setup)
TEST_EMAIL="abtest-${TIMESTAMP}@example.com"
TEST_PASSWORD="AbTest123!"
ACCESS_TOKEN=""
CREATED_USER_ID=""
CREATED_TABLE_ID=""

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

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

show_help() {
    echo "Apache Bench Load Testing for Day-One Backend API"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --requests NUM     Total number of requests (default: 100)"
    echo "  -c, --concurrency NUM  Number of concurrent requests (default: 10)"
    echo "  -h, --host URL         API host URL (default: http://localhost:8000)"
    echo "  --no-storage           Skip storage setup and storage benchmarks"
    echo "  --quick                Quick test (50 requests, 5 concurrent)"
    echo "  --stress               Stress test (1000 requests, 100 concurrent)"
    echo "  --help                 Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                           # Default: 100 requests, 10 concurrent"
    echo "  $0 -n 500 -c 25              # 500 requests, 25 concurrent"
    echo "  $0 --stress                  # Heavy load test"
    echo "  $0 -h http://api.example.com # Test against different host"
    exit 0
}

check_dependencies() {
    print_subheader "Checking Dependencies"
    
    if ! command -v ab &> /dev/null; then
        print_error "Apache Bench (ab) is not installed!"
        echo ""
        echo "Install with:"
        echo "  macOS:   brew install httpd (or use built-in)"
        echo "  Ubuntu:  sudo apt-get install apache2-utils"
        echo "  CentOS:  sudo yum install httpd-tools"
        exit 1
    fi
    print_success "Apache Bench (ab) found: $(which ab)"
    
    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed!"
        exit 1
    fi
    print_success "curl found: $(which curl)"
    
    if ! command -v jq &> /dev/null; then
        print_info "jq not found - JSON parsing will be limited"
        JQ_AVAILABLE=false
    else
        print_success "jq found: $(which jq)"
        JQ_AVAILABLE=true
    fi
}

check_api_health() {
    print_subheader "Checking API Health"
    
    # Try to hit the tables endpoint (should work with just API key)
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "X-API-Key: ${API_KEY}" \
        "${HOST}/tables/?skip=0&limit=1" 2>/dev/null || echo "000")
    
    if [ "$response" == "200" ]; then
        print_success "API is responding at ${HOST}"
    else
        print_error "API is not responding (HTTP $response). Make sure the server is running."
        echo "  Expected: HTTP 200"
        echo "  Got: HTTP $response"
        exit 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Setup Functions
# ─────────────────────────────────────────────────────────────────────────────

setup_test_user() {
    print_subheader "Setting Up Test User"
    
    # Create user
    create_response=$(curl -s -X POST "${HOST}/users/" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -d "{
            \"email\": \"${TEST_EMAIL}\",
            \"password\": \"${TEST_PASSWORD}\",
            \"firstName\": \"Apache\",
            \"lastName\": \"Bench\"
        }" 2>/dev/null)
    
    if $JQ_AVAILABLE; then
        CREATED_USER_ID=$(echo "$create_response" | jq -r '.id // empty')
    else
        # Fallback: simple grep for UUID pattern
        CREATED_USER_ID=$(echo "$create_response" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    fi
    
    if [ -n "$CREATED_USER_ID" ]; then
        print_success "Created test user: ${TEST_EMAIL} (ID: ${CREATED_USER_ID})"
    else
        print_error "Failed to create test user"
        echo "Response: $create_response"
    fi
    
    # Login to get access token
    login_response=$(curl -s -X POST "${HOST}/users/token" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -d "{
            \"email\": \"${TEST_EMAIL}\",
            \"password\": \"${TEST_PASSWORD}\"
        }" 2>/dev/null)
    
    if $JQ_AVAILABLE; then
        ACCESS_TOKEN=$(echo "$login_response" | jq -r '.access_token // empty')
    else
        # Fallback: grep for token pattern
        ACCESS_TOKEN=$(echo "$login_response" | grep -oE '"access_token":"[^"]+' | cut -d'"' -f4)
    fi
    
    if [ -n "$ACCESS_TOKEN" ]; then
        print_success "Obtained access token"
    else
        print_error "Failed to login"
        echo "Response: $login_response"
    fi
}

setup_test_table() {
    print_subheader "Setting Up Test Table"
    
    TABLE_NAME="abtable_$(date +%s)"
    
    create_response=$(curl -s -X POST "${HOST}/tables/" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -d "{
            \"name\": \"${TABLE_NAME}\",
            \"table_schema\": {
                \"name\": {\"type\": \"TEXT\", \"nullable\": false},
                \"value\": {\"type\": \"INTEGER\", \"nullable\": true}
            },
            \"public\": true,
            \"description\": \"Apache Bench test table\"
        }" 2>/dev/null)
    
    if $JQ_AVAILABLE; then
        CREATED_TABLE_ID=$(echo "$create_response" | jq -r '.id // empty')
    else
        CREATED_TABLE_ID=$(echo "$create_response" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    fi
    
    if [ -n "$CREATED_TABLE_ID" ]; then
        print_success "Created test table: ${TABLE_NAME} (ID: ${CREATED_TABLE_ID})"
    else
        print_error "Failed to create test table"
        echo "Response: $create_response"
    fi
}

create_output_dir() {
    # No longer needed - results shown in terminal only
    :
}

# ─────────────────────────────────────────────────────────────────────────────
# Benchmark Functions
# ─────────────────────────────────────────────────────────────────────────────

run_ab_test() {
    local name="$1"
    local method="$2"
    local url="$3"
    local extra_headers="$4"
    local post_data="$5"
    
    echo -e "${YELLOW}Testing: ${name}${NC}"
    echo "  Method: $method"
    echo "  URL: $url"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    # Build ab command
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Content-Type: application/json'"
    
    # Add extra headers if provided
    if [ -n "$extra_headers" ]; then
        ab_cmd+=" $extra_headers"
    fi
    
    local output=""
    
    # Handle POST/PATCH/DELETE methods
    if [ "$method" == "POST" ] || [ "$method" == "PATCH" ]; then
        # Create temp file for POST data
        local temp_file=$(mktemp)
        echo "$post_data" > "$temp_file"
        
        if [ "$method" == "POST" ]; then
            ab_cmd+=" -p '$temp_file' -T 'application/json'"
        else
            ab_cmd+=" -u '$temp_file' -T 'application/json'"
        fi
        ab_cmd+=" '${url}'"
        
        output=$(eval $ab_cmd 2>&1)
        rm -f "$temp_file"
    else
        ab_cmd+=" '${url}'"
        output=$(eval $ab_cmd 2>&1)
    fi
    
    # Extract metrics from output
    local rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local latency=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local failed=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    # Store results for summary
    TEST_NAMES+=("$name")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("$latency")
    TEST_FAILED+=("${failed:-0}")
    
    # Show brief result
    if [ "${failed:-0}" == "0" ]; then
        print_success "$name: ${rps} req/sec, ${latency}"
    else
        print_error "$name: ${rps} req/sec, ${latency}, ${failed} failed"
    fi
    echo ""
}

run_get_benchmark() {
    local name="$1"
    local endpoint="$2"
    local auth_required="$3"
    
    local extra_headers=""
    if [ "$auth_required" == "true" ] && [ -n "$ACCESS_TOKEN" ]; then
        extra_headers="-H 'Authorization: Bearer ${ACCESS_TOKEN}'"
    fi
    
    run_ab_test "$name" "GET" "${HOST}${endpoint}" "$extra_headers" ""
}

run_post_benchmark() {
    local name="$1"
    local endpoint="$2"
    local data="$3"
    local auth_required="$4"
    
    local extra_headers=""
    if [ "$auth_required" == "true" ] && [ -n "$ACCESS_TOKEN" ]; then
        extra_headers="-H 'Authorization: Bearer ${ACCESS_TOKEN}'"
    fi
    
    run_ab_test "$name" "POST" "${HOST}${endpoint}" "$extra_headers" "$data"
}

# ─────────────────────────────────────────────────────────────────────────────
# Test Suites
# ─────────────────────────────────────────────────────────────────────────────

run_public_endpoints() {
    print_header "Testing Public Endpoints (No Auth Required)"
    
    # List tables (public)
    run_get_benchmark "list_tables_public" "/tables/?skip=0&limit=10" "false"
}

run_auth_endpoints() {
    print_header "Testing Authentication Endpoints"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available - skipping auth tests"
        return
    fi
    
    # Get current user
    run_get_benchmark "get_current_user" "/users/me" "true"
    
    # List users (authenticated)
    run_get_benchmark "list_users" "/users/?skip=0&limit=10" "true"
    
    # List tables (authenticated)
    run_get_benchmark "list_tables_auth" "/tables/?skip=0&limit=10" "true"
}

run_table_endpoints() {
    print_header "Testing Table Endpoints"
    
    if [ -z "$ACCESS_TOKEN" ] || [ -z "$CREATED_TABLE_ID" ]; then
        print_error "Missing access token or table ID - skipping table tests"
        return
    fi
    
    # Get specific table
    run_get_benchmark "get_table" "/tables/${CREATED_TABLE_ID}" "true"
    
    # Get table data
    run_get_benchmark "get_table_data" "/tables/${CREATED_TABLE_ID}/data?page=1&page_size=10" "true"
}

run_write_endpoints() {
    print_header "Testing Write Endpoints (POST)"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available - skipping write tests"
        return
    fi
    
    # Insert row into table
    if [ -n "$CREATED_TABLE_ID" ]; then
        local row_data='{"name": "ab_test_item", "value": 42}'
        run_post_benchmark "insert_row" "/tables/${CREATED_TABLE_ID}/data" "$row_data" "true"
    fi
    
    # Note: Creating new tables/users with ab is tricky because each request
    # would need unique data. We'll do a single concurrent batch test instead.
}

run_user_registration_test() {
    print_header "Testing User Registration (Unique Users)"
    
    # This is a special test - we create a temporary JSON file with user data
    # Note: All users will have the same email, so most will fail with 409 Conflict
    # This is intentional to test error handling under load
    
    local unique_email="abload-${TIMESTAMP}@example.com"
    local user_data="{\"email\": \"${unique_email}\", \"password\": \"TestLoad123!\", \"firstName\": \"Load\", \"lastName\": \"Test\"}"
    
    run_post_benchmark "user_registration" "/users/" "$user_data" "false"
    
    print_info "Note: Most requests will fail with 409 (duplicate email) - this tests error handling"
}

# ─────────────────────────────────────────────────────────────────────────────
# Storage Bucket Endpoints
# ─────────────────────────────────────────────────────────────────────────────

CREATED_BUCKET_ID=""
CREATED_BUCKET_NAME=""

# Functions and Webhooks test resources
CREATED_FUNCTION_ID=""
CREATED_FUNCTION_NAME=""
CREATED_WEBHOOK_ID=""
CREATED_WEBHOOK_NAME=""
CREATED_WEBHOOK_TOKEN=""

generate_bucket_name() {
    local prefix=$(echo $RANDOM | md5sum | head -c1 | tr '[:upper:]' '[:lower:]')
    local middle=$(echo $RANDOM | md5sum | head -c10 | tr '[:upper:]' '[:lower:]')
    echo "abtest-${prefix}${middle}"
}

setup_test_bucket() {
    print_subheader "Setting Up Test Bucket"
    
    CREATED_BUCKET_NAME=$(generate_bucket_name)
    
    create_response=$(curl -s -X POST "${HOST}/storage/buckets/" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -d "{
            \"name\": \"${CREATED_BUCKET_NAME}\",
            \"public\": true,
            \"description\": \"Apache Bench test bucket\"
        }" 2>/dev/null)
    
    if $JQ_AVAILABLE; then
        CREATED_BUCKET_ID=$(echo "$create_response" | jq -r '.id // empty')
    else
        CREATED_BUCKET_ID=$(echo "$create_response" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    fi
    
    if [ -n "$CREATED_BUCKET_ID" ]; then
        print_success "Created test bucket: ${CREATED_BUCKET_NAME} (ID: ${CREATED_BUCKET_ID})"
    else
        print_error "Failed to create test bucket"
        echo "Response: $create_response"
    fi
}

setup_test_function() {
    print_subheader "Setting Up Test Function (Admin)"
    
    CREATED_FUNCTION_NAME="abtest_func_$(date +%s)"
    
    print_info "Using admin credentials: ${ADMIN_EMAIL}"
    
    # Functions require admin access - using the admin token from .env
    local admin_login_response=$(curl -s -X POST "${HOST}/users/token" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -d "{
            \"email\": \"${ADMIN_EMAIL}\",
            \"password\": \"${ADMIN_PASSWORD}\"
        }" 2>/dev/null)
    
    local admin_token=""
    if $JQ_AVAILABLE; then
        admin_token=$(echo "$admin_login_response" | jq -r '.access_token // empty')
    else
        admin_token=$(echo "$admin_login_response" | grep -oE '"access_token":"[^"]+' | cut -d'"' -f4)
    fi
    
    if [ -z "$admin_token" ]; then
        print_error "Failed to get admin token for ${ADMIN_EMAIL} - skipping function/webhook setup"
        print_info "Make sure ADMIN_EMAIL and ADMIN_PASSWORD are set correctly in .env"
        return
    fi
    
    # Store admin token for function/webhook operations
    ADMIN_TOKEN="$admin_token"
    
    # Create a simple test function using a temp file for proper JSON encoding
    local temp_json=$(mktemp)
    cat > "$temp_json" << 'FUNC_JSON'
{
    "name": "FUNC_NAME_PLACEHOLDER",
    "code": "export default async (req) => { return new Response(JSON.stringify({ message: 'Hello from ab test' }), { headers: { 'Content-Type': 'application/json' } }); };",
    "description": "Apache Bench test function",
    "timeout_seconds": 30
}
FUNC_JSON
    
    # Replace placeholder with actual function name
    sed -i.bak "s/FUNC_NAME_PLACEHOLDER/${CREATED_FUNCTION_NAME}/" "$temp_json"
    rm -f "${temp_json}.bak"
    
    create_response=$(curl -s -X POST "${HOST}/functions/" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -H "Authorization: Bearer ${admin_token}" \
        -d @"$temp_json" 2>/dev/null)
    
    rm -f "$temp_json"
    
    if $JQ_AVAILABLE; then
        CREATED_FUNCTION_ID=$(echo "$create_response" | jq -r '.id // empty')
    else
        CREATED_FUNCTION_ID=$(echo "$create_response" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    fi
    
    if [ -n "$CREATED_FUNCTION_ID" ]; then
        print_success "Created test function: ${CREATED_FUNCTION_NAME} (ID: ${CREATED_FUNCTION_ID})"
    else
        print_error "Failed to create test function"
        echo "Response: $create_response"
    fi
}

setup_test_webhook() {
    print_subheader "Setting Up Test Webhook (Admin)"
    
    if [ -z "$CREATED_FUNCTION_ID" ] || [ -z "$ADMIN_TOKEN" ]; then
        print_error "No function ID or admin token available - skipping webhook setup"
        return
    fi
    
    CREATED_WEBHOOK_NAME="abtest_webhook_$(date +%s)"
    
    create_response=$(curl -s -X POST "${HOST}/webhooks/" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        -d "{
            \"function_id\": \"${CREATED_FUNCTION_ID}\",
            \"name\": \"${CREATED_WEBHOOK_NAME}\",
            \"description\": \"Apache Bench test webhook\",
            \"secret_key\": \"ab_test_secret_key_12345\",
            \"provider\": \"test\",
            \"rate_limit_per_minute\": 1000,
            \"retry_attempts\": 3
        }" 2>/dev/null)
    
    if $JQ_AVAILABLE; then
        CREATED_WEBHOOK_ID=$(echo "$create_response" | jq -r '.id // empty')
        CREATED_WEBHOOK_TOKEN=$(echo "$create_response" | jq -r '.webhook_token // empty')
    else
        CREATED_WEBHOOK_ID=$(echo "$create_response" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
        CREATED_WEBHOOK_TOKEN=$(echo "$create_response" | grep -oE '"webhook_token":"[^"]+' | cut -d'"' -f4)
    fi
    
    if [ -n "$CREATED_WEBHOOK_ID" ]; then
        print_success "Created test webhook: ${CREATED_WEBHOOK_NAME} (ID: ${CREATED_WEBHOOK_ID})"
        print_info "Webhook token: ${CREATED_WEBHOOK_TOKEN:0:20}..."
    else
        print_error "Failed to create test webhook"
        echo "Response: $create_response"
    fi
}

run_storage_bucket_endpoints() {
    print_header "Testing Storage Bucket Endpoints"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available - skipping storage bucket tests"
        return
    fi
    
    # List buckets
    run_get_benchmark "list_buckets" "/storage/buckets/?skip=0&limit=10" "true"
    
    # Get bucket count
    run_get_benchmark "bucket_count" "/storage/buckets/count" "true"
    
    # Get specific bucket (if created)
    if [ -n "$CREATED_BUCKET_ID" ]; then
        run_get_benchmark "get_bucket" "/storage/buckets/${CREATED_BUCKET_ID}" "true"
    fi
}

run_storage_file_endpoints() {
    print_header "Testing Storage File Endpoints"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available - skipping storage file tests"
        return
    fi
    
    # Get storage stats
    run_get_benchmark "storage_stats" "/storage/files/stats" "true"
    
    # Get total file count
    run_get_benchmark "total_file_count" "/storage/files/total-count" "true"
    
    # List files in bucket (if bucket exists)
    if [ -n "$CREATED_BUCKET_ID" ]; then
        run_get_benchmark "list_files" "/storage/files/?bucket_id=${CREATED_BUCKET_ID}&page=1&page_size=10" "true"
        
        # Get file count for bucket
        run_get_benchmark "file_count" "/storage/files/count?bucket_id=${CREATED_BUCKET_ID}" "true"
    fi
}

run_storage_write_endpoints() {
    print_header "Testing Storage Write Endpoints"
    
    if [ -z "$ACCESS_TOKEN" ] || [ -z "$CREATED_BUCKET_ID" ]; then
        print_error "Missing access token or bucket ID - skipping storage write tests"
        return
    fi
    
    # Test bucket updates
    local update_data='{"description": "Updated by Apache Bench", "public": true}'
    
    # Create a temporary file for the PATCH data
    local temp_file=$(mktemp)
    echo "$update_data" > "$temp_file"
    
    echo -e "${YELLOW}Testing: update_bucket${NC}"
    echo "  Method: PATCH"
    echo "  URL: ${HOST}/storage/buckets/${CREATED_BUCKET_ID}"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Content-Type: application/json'"
    ab_cmd+=" -H 'Authorization: Bearer ${ACCESS_TOKEN}'"
    ab_cmd+=" -u '$temp_file' -T 'application/json'"
    ab_cmd+=" '${HOST}/storage/buckets/${CREATED_BUCKET_ID}'"
    
    local output=$(eval $ab_cmd 2>&1)
    
    rm -f "$temp_file"
    
    local rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local latency=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local failed=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    TEST_NAMES+=("update_bucket")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("$latency")
    TEST_FAILED+=("${failed:-0}")
    
    if [ "${failed:-0}" == "0" ]; then
        print_success "update_bucket: ${rps} req/sec, ${latency}"
    else
        print_error "update_bucket: ${rps} req/sec, ${latency}, ${failed} failed"
    fi
    echo ""
    
    # ─────────────────────────────────────────────────────────────────────────
    # File Upload Benchmark (using real test files)
    # ─────────────────────────────────────────────────────────────────────────
    run_file_upload_benchmark
}

# Test files directory (relative to this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_FILES_DIR="${SCRIPT_DIR}/../storage/benchmarks/test-files"

run_file_upload_benchmark() {
    print_subheader "Testing File Upload (Streaming)"
    
    # Find a small test file (< 10MB) to use for upload benchmarks
    local test_file=""
    local test_file_name=""
    local test_file_size=0
    
    if [ -d "$TEST_FILES_DIR" ]; then
        # Find the smallest file in the test-files directory
        for f in "$TEST_FILES_DIR"/*; do
            if [ -f "$f" ]; then
                local size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
                # Use files under 10MB for the benchmark
                if [ "$size" -lt 10485760 ]; then
                    if [ -z "$test_file" ] || [ "$size" -lt "$test_file_size" ]; then
                        test_file="$f"
                        test_file_name=$(basename "$f")
                        test_file_size=$size
                    fi
                fi
            fi
        done
    fi
    
    if [ -z "$test_file" ]; then
        print_info "No small test files found in ${TEST_FILES_DIR} - creating a sample file"
        test_file=$(mktemp)
        # Create a ~100KB sample file
        dd if=/dev/urandom of="$test_file" bs=1024 count=100 2>/dev/null
        test_file_name="sample_test_file.bin"
        test_file_size=102400
        local created_sample=true
    fi
    
    # Convert size to human readable
    local size_kb=$((test_file_size / 1024))
    print_info "Using test file: ${test_file_name} (${size_kb} KB)"
    
    # URL encode filename for query parameter
    local encoded_filename=$(printf '%s' "$test_file_name" | sed 's/ /%20/g; s/!/%21/g; s/"/%22/g; s/#/%23/g; s/\$/%24/g; s/\&/%26/g; s/'\''/%27/g; s/(/%28/g; s/)/%29/g; s/\*/%2A/g; s/+/%2B/g; s/,/%2C/g')
    
    # First, verify upload works with a single curl request (streaming)
    echo -n "  Verifying streaming upload with curl... "
    local verify_path="ab-test-verify/${test_file_name}"
    local encoded_verify_path=$(printf '%s' "$verify_path" | sed 's/ /%20/g; s/!/%21/g; s/"/%22/g; s/#/%23/g; s/\$/%24/g; s/\&/%26/g; s/'\''/%27/g; s/(/%28/g; s/)/%29/g; s/\*/%2A/g; s/+/%2B/g; s/,/%2C/g')
    local curl_response=$(curl -s -w "%{http_code}" -o /dev/null \
        -X POST "${HOST}/storage/files/upload?bucket_id=${CREATED_BUCKET_ID}&path=${encoded_verify_path}&filename=${encoded_filename}&content_type=application/octet-stream" \
        -H "X-API-Key: ${API_KEY}" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H "Content-Type: application/octet-stream" \
        -H "Content-Length: ${test_file_size}" \
        --data-binary "@${test_file}" 2>/dev/null)
    
    if [ "$curl_response" == "201" ] || [ "$curl_response" == "200" ]; then
        echo -e "${GREEN}✓ (HTTP ${curl_response})${NC}"
    else
        echo -e "${RED}✗ (HTTP ${curl_response})${NC}"
        print_error "File upload verification failed - skipping file upload benchmark"
        return
    fi
    
    # Use curl for file upload benchmark (streaming - raw bytes)
    echo -e "${YELLOW}Testing: file_upload${NC}"
    echo "  Method: POST (streaming raw bytes)"
    echo "  URL: ${HOST}/storage/files/upload"
    echo "  File: ${test_file_name} (${size_kb} KB)"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    local success_count=0
    local fail_count=0
    local total_time=0
    local start_time=$(date +%s%N)
    
    # Run uploads in batches for concurrency simulation
    for ((i=0; i<TOTAL_REQUESTS; i+=CONCURRENCY)); do
        local batch_pids=()
        local batch_results=()
        
        for ((j=0; j<CONCURRENCY && (i+j)<TOTAL_REQUESTS; j++)); do
            (
                local upload_path="ab-uploads/bench_${i}_${j}_${test_file_name}"
                local encoded_path=$(printf '%s' "$upload_path" | sed 's/ /%20/g; s/!/%21/g; s/"/%22/g; s/#/%23/g; s/\$/%24/g; s/\&/%26/g; s/'\''/%27/g; s/(/%28/g; s/)/%29/g; s/\*/%2A/g; s/+/%2B/g; s/,/%2C/g')
                local response=$(curl -s -w "%{http_code}" -o /dev/null \
                    -X POST "${HOST}/storage/files/upload?bucket_id=${CREATED_BUCKET_ID}&path=${encoded_path}&filename=${encoded_filename}&content_type=application/octet-stream" \
                    -H "X-API-Key: ${API_KEY}" \
                    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
                    -H "Content-Type: application/octet-stream" \
                    -H "Content-Length: ${test_file_size}" \
                    --data-binary "@${test_file}" 2>/dev/null)
                
                if [ "$response" == "201" ] || [ "$response" == "200" ]; then
                    exit 0
                else
                    exit 1
                fi
            ) &
            batch_pids+=($!)
        done
        
        # Wait for batch to complete and count results
        for pid in "${batch_pids[@]}"; do
            if wait $pid; then
                ((success_count++))
            else
                ((fail_count++))
            fi
        done
    done
    
    local end_time=$(date +%s%N)
    local duration_ns=$((end_time - start_time))
    local duration_ms=$((duration_ns / 1000000))
    local duration_sec=$(echo "scale=3; $duration_ms / 1000" | bc)
    
    # Calculate metrics
    local rps=$(echo "scale=2; $TOTAL_REQUESTS / $duration_sec" | bc)
    local latency_ms=$(echo "scale=3; $duration_ms / $TOTAL_REQUESTS" | bc)
    
    # Cleanup sample file if created
    [ "${created_sample:-false}" == "true" ] && rm -f "$test_file"
    
    TEST_NAMES+=("file_upload")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("${latency_ms} [ms]")
    TEST_FAILED+=("$fail_count")
    
    if [ "$fail_count" == "0" ]; then
        print_success "file_upload: ${rps} req/sec, ${latency_ms} [ms]"
        print_info "Transfer: ${size_kb} KB x ${success_count} = $((size_kb * success_count / 1024)) MB total"
    else
        print_error "file_upload: ${rps} req/sec, ${latency_ms} [ms], ${fail_count} failed"
    fi
    echo ""
    
    # Run download benchmark for the file we just uploaded
    # We use the path from the last successful upload to ensure file exists
    local download_path="ab-uploads/bench_0_0_${test_file_name}"
    run_file_download_benchmark "${download_path}" "${size_kb}"
}

run_file_download_benchmark() {
    local file_path="$1"
    local size_kb="$2"
    
    print_subheader "Testing File Download"
    
    if [ -z "$CREATED_BUCKET_NAME" ]; then
        print_error "No bucket name available - skipping download test"
        return
    fi
    
    echo -e "${YELLOW}Testing: file_download${NC}"
    echo "  Method: GET"
    echo "  URL: ${HOST}/storage/files/download/${CREATED_BUCKET_NAME}/${file_path}"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    # Using ab for downloads is reliable
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Authorization: Bearer ${ACCESS_TOKEN}'"
    # Suppress output progress
    ab_cmd+=" -q"
    ab_cmd+=" '${HOST}/storage/files/download/${CREATED_BUCKET_NAME}/${file_path}'"
    
    local output=$(eval $ab_cmd 2>&1)
    
    local rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local latency=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local failed=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    TEST_NAMES+=("file_download")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("$latency")
    TEST_FAILED+=("${failed:-0}")
    
    if [ "${failed:-0}" == "0" ]; then
        print_success "file_download: ${rps} req/sec, ${latency}"
    else
        print_error "file_download: ${rps} req/sec, ${latency}, ${failed} failed"
    fi
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Functions Endpoints
# ─────────────────────────────────────────────────────────────────────────────

run_function_read_endpoints() {
    print_header "Testing Function Read Endpoints (Admin)"
    
    if [ -z "$ADMIN_TOKEN" ]; then
        print_error "No admin token available - skipping function tests"
        return
    fi
    
    # List functions
    echo -e "${YELLOW}Testing: list_functions${NC}"
    echo "  Method: GET"
    echo "  URL: ${HOST}/functions/?limit=10&offset=0"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Content-Type: application/json'"
    ab_cmd+=" -H 'Authorization: Bearer ${ADMIN_TOKEN}'"
    ab_cmd+=" '${HOST}/functions/?limit=10&offset=0'"
    
    local output=$(eval $ab_cmd 2>&1)
    
    local rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local latency=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local failed=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    TEST_NAMES+=("list_functions")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("$latency")
    TEST_FAILED+=("${failed:-0}")
    
    if [ "${failed:-0}" == "0" ]; then
        print_success "list_functions: ${rps} req/sec, ${latency}"
    else
        print_error "list_functions: ${rps} req/sec, ${latency}, ${failed} failed"
    fi
    echo ""
    
    # Get function count
    run_get_benchmark_with_admin "function_count" "/functions/count" 
    
    # Get specific function (if created)
    if [ -n "$CREATED_FUNCTION_ID" ]; then
        run_get_benchmark_with_admin "get_function" "/functions/${CREATED_FUNCTION_ID}"
    fi
}

run_get_benchmark_with_admin() {
    local name="$1"
    local endpoint="$2"
    
    echo -e "${YELLOW}Testing: ${name}${NC}"
    echo "  Method: GET"
    echo "  URL: ${HOST}${endpoint}"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Content-Type: application/json'"
    ab_cmd+=" -H 'Authorization: Bearer ${ADMIN_TOKEN}'"
    ab_cmd+=" '${HOST}${endpoint}'"
    
    local output=$(eval $ab_cmd 2>&1)
    
    local rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local latency=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local failed=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    TEST_NAMES+=("$name")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("$latency")
    TEST_FAILED+=("${failed:-0}")
    
    if [ "${failed:-0}" == "0" ]; then
        print_success "$name: ${rps} req/sec, ${latency}"
    else
        print_error "$name: ${rps} req/sec, ${latency}, ${failed} failed"
    fi
    echo ""
}

run_function_write_endpoints() {
    print_header "Testing Function Write Endpoints (Admin)"
    
    if [ -z "$ADMIN_TOKEN" ] || [ -z "$CREATED_FUNCTION_ID" ]; then
        print_error "Missing admin token or function ID - skipping function write tests"
        return
    fi
    
    # Test function updates (PATCH)
    local update_data='{"description": "Updated by Apache Bench load test"}'
    
    local temp_file=$(mktemp)
    echo "$update_data" > "$temp_file"
    
    echo -e "${YELLOW}Testing: update_function${NC}"
    echo "  Method: PATCH"
    echo "  URL: ${HOST}/functions/${CREATED_FUNCTION_ID}"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Content-Type: application/json'"
    ab_cmd+=" -H 'Authorization: Bearer ${ADMIN_TOKEN}'"
    ab_cmd+=" -u '$temp_file' -T 'application/json'"
    ab_cmd+=" '${HOST}/functions/${CREATED_FUNCTION_ID}'"
    
    local output=$(eval $ab_cmd 2>&1)
    
    rm -f "$temp_file"
    
    local rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local latency=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local failed=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    TEST_NAMES+=("update_function")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("$latency")
    TEST_FAILED+=("${failed:-0}")
    
    if [ "${failed:-0}" == "0" ]; then
        print_success "update_function: ${rps} req/sec, ${latency}"
    else
        print_error "update_function: ${rps} req/sec, ${latency}, ${failed} failed"
    fi
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Webhooks Endpoints
# ─────────────────────────────────────────────────────────────────────────────

run_webhook_read_endpoints() {
    print_header "Testing Webhook Read Endpoints (Admin)"
    
    if [ -z "$ADMIN_TOKEN" ]; then
        print_error "No admin token available - skipping webhook tests"
        return
    fi
    
    # List webhooks
    run_get_benchmark_with_admin "list_webhooks" "/webhooks/?limit=10&offset=0"
    
    # Get specific webhook (if created)
    if [ -n "$CREATED_WEBHOOK_ID" ]; then
        run_get_benchmark_with_admin "get_webhook" "/webhooks/${CREATED_WEBHOOK_ID}"
    fi
}

run_webhook_write_endpoints() {
    print_header "Testing Webhook Write Endpoints (Admin)"
    
    if [ -z "$ADMIN_TOKEN" ] || [ -z "$CREATED_WEBHOOK_ID" ]; then
        print_error "Missing admin token or webhook ID - skipping webhook write tests"
        return
    fi
    
    # Test webhook updates (PATCH)
    local update_data='{"description": "Updated by Apache Bench load test", "is_active": true}'
    
    local temp_file=$(mktemp)
    echo "$update_data" > "$temp_file"
    
    echo -e "${YELLOW}Testing: update_webhook${NC}"
    echo "  Method: PATCH"
    echo "  URL: ${HOST}/webhooks/${CREATED_WEBHOOK_ID}"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Content-Type: application/json'"
    ab_cmd+=" -H 'Authorization: Bearer ${ADMIN_TOKEN}'"
    ab_cmd+=" -u '$temp_file' -T 'application/json'"
    ab_cmd+=" '${HOST}/webhooks/${CREATED_WEBHOOK_ID}'"
    
    local output=$(eval $ab_cmd 2>&1)
    
    rm -f "$temp_file"
    
    local rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local latency=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local failed=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    TEST_NAMES+=("update_webhook")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("$latency")
    TEST_FAILED+=("${failed:-0}")
    
    if [ "${failed:-0}" == "0" ]; then
        print_success "update_webhook: ${rps} req/sec, ${latency}"
    else
        print_error "update_webhook: ${rps} req/sec, ${latency}, ${failed} failed"
    fi
    echo ""
    
    # Test webhook token regeneration
    echo -e "${YELLOW}Testing: regenerate_webhook_token${NC}"
    echo "  Method: POST"
    echo "  URL: ${HOST}/webhooks/${CREATED_WEBHOOK_ID}/regenerate-token"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    
    # Create empty temp file for POST with no body
    local empty_file=$(mktemp)
    echo "{}" > "$empty_file"
    
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Content-Type: application/json'"
    ab_cmd+=" -H 'Authorization: Bearer ${ADMIN_TOKEN}'"
    ab_cmd+=" -p '$empty_file' -T 'application/json'"
    ab_cmd+=" '${HOST}/webhooks/${CREATED_WEBHOOK_ID}/regenerate-token'"
    
    local output=$(eval $ab_cmd 2>&1)
    
    rm -f "$empty_file"
    
    local rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local latency=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local failed=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    TEST_NAMES+=("regenerate_webhook_token")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("$latency")
    TEST_FAILED+=("${failed:-0}")
    
    if [ "${failed:-0}" == "0" ]; then
        print_success "regenerate_webhook_token: ${rps} req/sec, ${latency}"
    else
        print_error "regenerate_webhook_token: ${rps} req/sec, ${latency}, ${failed} failed"
    fi
    echo ""
}

run_webhook_trigger_endpoint() {
    print_header "Testing Webhook Trigger Endpoint (Public)"
    
    if [ -z "$CREATED_WEBHOOK_TOKEN" ]; then
        print_error "No webhook token available - skipping webhook trigger test"
        return
    fi
    
    # The trigger endpoint is public (no auth required)
    local trigger_data='{"event": "test", "data": {"message": "Apache Bench trigger test"}}'
    
    local temp_file=$(mktemp)
    echo "$trigger_data" > "$temp_file"
    
    echo -e "${YELLOW}Testing: trigger_webhook${NC}"
    echo "  Method: POST"
    echo "  URL: ${HOST}/webhooks/trigger/${CREATED_WEBHOOK_TOKEN}"
    echo "  Requests: $TOTAL_REQUESTS, Concurrency: $CONCURRENCY"
    echo "  Note: Public endpoint - no auth required"
    
    # Note: We only use X-API-Key here, not Authorization
    local ab_cmd="ab -n $TOTAL_REQUESTS -c $CONCURRENCY"
    ab_cmd+=" -H 'X-API-Key: ${API_KEY}'"
    ab_cmd+=" -H 'Content-Type: application/json'"
    ab_cmd+=" -p '$temp_file' -T 'application/json'"
    ab_cmd+=" '${HOST}/webhooks/trigger/${CREATED_WEBHOOK_TOKEN}'"
    
    local output=$(eval $ab_cmd 2>&1)
    
    rm -f "$temp_file"
    
    local rps=$(echo "$output" | grep "Requests per second:" | awk '{print $4}')
    local latency=$(echo "$output" | grep "Time per request:" | head -1 | awk '{print $4 " " $5}')
    local failed=$(echo "$output" | grep "Failed requests:" | awk '{print $3}')
    
    TEST_NAMES+=("trigger_webhook")
    TEST_RPS+=("$rps")
    TEST_LATENCY+=("$latency")
    TEST_FAILED+=("${failed:-0}")
    
    if [ "${failed:-0}" == "0" ]; then
        print_success "trigger_webhook: ${rps} req/sec, ${latency}"
    else
        print_error "trigger_webhook: ${rps} req/sec, ${latency}, ${failed} failed"
    fi
    print_info "Note: This endpoint invokes the linked function, actual performance depends on function execution"
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Cleanup Functions and Webhooks
# ─────────────────────────────────────────────────────────────────────────────

cleanup_webhook() {
    print_subheader "Cleaning Up Webhook Resources"
    
    if [ -n "$CREATED_WEBHOOK_ID" ] && [ -n "$ADMIN_TOKEN" ]; then
        echo -n "  Deleting webhook: ${CREATED_WEBHOOK_NAME}... "
        local response=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
            -H "X-API-Key: ${API_KEY}" \
            -H "Authorization: Bearer ${ADMIN_TOKEN}" \
            "${HOST}/webhooks/${CREATED_WEBHOOK_ID}" 2>/dev/null)
        
        if [ "$response" == "204" ] || [ "$response" == "200" ]; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${YELLOW}× (HTTP ${response})${NC}"
        fi
    fi
}

cleanup_function() {
    print_subheader "Cleaning Up Function Resources"
    
    if [ -n "$CREATED_FUNCTION_ID" ] && [ -n "$ADMIN_TOKEN" ]; then
        echo -n "  Deleting function: ${CREATED_FUNCTION_NAME}... "
        local response=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
            -H "X-API-Key: ${API_KEY}" \
            -H "Authorization: Bearer ${ADMIN_TOKEN}" \
            "${HOST}/functions/${CREATED_FUNCTION_ID}" 2>/dev/null)
        
        if [ "$response" == "204" ] || [ "$response" == "200" ]; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${YELLOW}× (HTTP ${response})${NC}"
        fi
    fi
}

cleanup_table() {
    print_subheader "Cleaning Up Table Resources"
    
    # Delete test table (owned by test user)
    if [ -n "$CREATED_TABLE_ID" ]; then
        echo -n "  Deleting table: ${TABLE_NAME}... "
        local response=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
            -H "X-API-Key: ${API_KEY}" \
            -H "Authorization: Bearer ${ACCESS_TOKEN}" \
            "${HOST}/tables/${CREATED_TABLE_ID}" 2>/dev/null)
        
        if [ "$response" == "200" ]; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${YELLOW}× (HTTP ${response})${NC}"
        fi
    fi
}

cleanup_storage() {
    print_subheader "Cleaning Up Storage Resources"
    
    if [ -z "$CREATED_BUCKET_ID" ]; then
        print_info "No bucket to clean up"
        return
    fi
    
    # Delete the bucket (which now automatically deletes all files inside)
    echo -n "  Deleting bucket: ${CREATED_BUCKET_NAME} (and all files inside)... "
    local delete_response=$(curl -s -w "\n%{http_code}" -X DELETE \
        -H "X-API-Key: ${API_KEY}" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        "${HOST}/storage/buckets/${CREATED_BUCKET_ID}" 2>/dev/null)
    
    local response=$(echo "$delete_response" | tail -n1)
    local body=$(echo "$delete_response" | sed '$d')
    
    if [ "$response" == "204" ] || [ "$response" == "200" ]; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${YELLOW}× (HTTP ${response})${NC}"
        if [ -n "$body" ]; then
            echo "    Response: $body"
        fi
    fi
}

cleanup_user() {
    print_subheader "Cleaning Up User Resources"
    
    # Delete test user - requires admin privileges
    # First, login as admin (using credentials from .env)
    if [ -n "$CREATED_USER_ID" ]; then
        echo -n "  Getting admin token... "
        local admin_login_response=$(curl -s -X POST "${HOST}/users/token" \
            -H "Content-Type: application/json" \
            -H "X-API-Key: ${API_KEY}" \
            -d "{
                \"email\": \"${ADMIN_EMAIL}\",
                \"password\": \"${ADMIN_PASSWORD}\"
            }" 2>/dev/null)
        
        local admin_token=""
        if $JQ_AVAILABLE; then
            admin_token=$(echo "$admin_login_response" | jq -r '.access_token // empty')
        else
            admin_token=$(echo "$admin_login_response" | grep -oE '"access_token":"[^"]+' | cut -d'"' -f4)
        fi
        
        if [ -n "$admin_token" ]; then
            echo -e "${GREEN}✓${NC}"
            
            echo -n "  Deleting user: ${TEST_EMAIL}... "
            local response=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
                -H "X-API-Key: ${API_KEY}" \
                -H "Authorization: Bearer ${admin_token}" \
                "${HOST}/users/${CREATED_USER_ID}" 2>/dev/null)
            
            if [ "$response" == "200" ]; then
                echo -e "${GREEN}✓${NC}"
            else
                echo -e "${YELLOW}× (HTTP ${response})${NC}"
            fi
            
            # Also delete the abload user created during registration test
            local abload_email="abload-${TIMESTAMP}@example.com"
            echo -n "  Deleting registration test user: ${abload_email}... "
            
            # We need to find the ID first
            # Use admin token to search
            local search_response=$(curl -s -X GET "${HOST}/users/?search=${abload_email}&limit=1" \
                -H "X-API-Key: ${API_KEY}" \
                -H "Authorization: Bearer ${admin_token}" 2>/dev/null)
                
            local abload_id=""
            if $JQ_AVAILABLE; then
                abload_id=$(echo "$search_response" | jq -r '.[0].id // empty')
            else
                # Fallback grep for UUID
                abload_id=$(echo "$search_response" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
            fi
            
            if [ -n "$abload_id" ]; then
                local response=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
                    -H "X-API-Key: ${API_KEY}" \
                    -H "Authorization: Bearer ${admin_token}" \
                    "${HOST}/users/${abload_id}" 2>/dev/null)
                    
                if [ "$response" == "200" ]; then
                    echo -e "${GREEN}✓${NC}"
                else
                    echo -e "${YELLOW}× (HTTP ${response})${NC}"
                fi
            else
                echo -e "${YELLOW}× (User not found)${NC}"
            fi
        else
            echo -e "${YELLOW}× (could not get admin token)${NC}"
            print_info "User ${TEST_EMAIL} was not deleted - requires admin access"
        fi
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Summary Report
# ─────────────────────────────────────────────────────────────────────────────

generate_summary() {
    print_header "Benchmark Summary"
    
    # Display summary table in terminal
    echo ""
    echo -e "${CYAN}┌─────────────────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│                           APACHE BENCH RESULTS SUMMARY                                 │${NC}"
    echo -e "${CYAN}├─────────────────────────────────────────────────────────────────────────────────────────┤${NC}"
    printf "${CYAN}│${NC} %-25s ${CYAN}│${NC} %10s ${CYAN}│${NC} %14s ${CYAN}│${NC} %8s ${CYAN}│${NC} %10s ${CYAN}│${NC}\n" \
        "ENDPOINT" "REQ/SEC" "LATENCY" "FAILED" "STATUS"
    echo -e "${CYAN}├─────────────────────────────────────────────────────────────────────────────────────────┤${NC}"
    
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
        
        printf "${CYAN}│${NC} %-25s ${CYAN}│${NC} %10s ${CYAN}│${NC} %14s ${CYAN}│${NC} %8s ${CYAN}│${NC} %b ${CYAN}│${NC}\n" \
            "$display_name" "$rps" "$latency" "$failed" "$status"
        
        # Track fastest/slowest
        local rps_int=$(echo "$rps" | cut -d'.' -f1)
        if [ -n "$rps_int" ] && [ "$rps_int" != "0" ]; then
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
    
    echo -e "${CYAN}└─────────────────────────────────────────────────────────────────────────────────────────┘${NC}"
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
    echo "  Storage benchmarks: ${RUN_STORAGE}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Parse Arguments
# ─────────────────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--requests)
            TOTAL_REQUESTS="$2"
            shift 2
            ;;
        -c|--concurrency)
            CONCURRENCY="$2"
            shift 2
            ;;
        -h|--host)
            HOST="$2"
            shift 2
            ;;
        --no-storage)
            RUN_STORAGE=false
            shift
            ;;
        --quick)
            TOTAL_REQUESTS=50
            CONCURRENCY=5
            shift
            ;;
        --stress)
            TOTAL_REQUESTS=1000
            CONCURRENCY=100
            shift
            ;;
        --help)
            show_help
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            ;;
    esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Main Execution
# ─────────────────────────────────────────────────────────────────────────────

main() {
    print_header "Apache Bench Load Testing for Day-One Backend"
    
    echo "Configuration:"
    echo "  Host: ${HOST}"
    echo "  Requests: ${TOTAL_REQUESTS}"
    echo "  Concurrency: ${CONCURRENCY}"
    echo "  Storage benchmarks: ${RUN_STORAGE}"
    echo ""
    
    # Pre-flight checks
    check_dependencies
    check_api_health
    create_output_dir
    
    # Setup test resources
    setup_test_user
    setup_test_table
    if $RUN_STORAGE; then
        setup_test_bucket
    fi
    setup_test_function
    setup_test_webhook
    
    # Run benchmark suites (original endpoints)
    run_public_endpoints
    run_auth_endpoints
    run_table_endpoints
    run_write_endpoints
    run_user_registration_test
    
    # Run storage benchmark suites (new endpoints)
    if $RUN_STORAGE; then
        run_storage_bucket_endpoints
        run_storage_file_endpoints
        run_storage_write_endpoints
    else
        print_info "Storage benchmarks skipped (--no-storage)"
    fi
    
    # Run function benchmark suites (admin only)
    run_function_read_endpoints
    run_function_write_endpoints
    
    # Run webhook benchmark suites (admin + public trigger)
    run_webhook_read_endpoints
    run_webhook_write_endpoints
    run_webhook_trigger_endpoint
    
    # Generate summary
    generate_summary
    
    # Cleanup all test resources (in reverse creation order)
    cleanup_webhook    # Delete webhook first (depends on function)
    cleanup_function   # Delete function (admin resource)
    cleanup_table      # Delete test table (owned by test user)
    $RUN_STORAGE && cleanup_storage    # Delete test bucket and files
    cleanup_user       # Delete test user last (requires admin)
    
    print_header "Testing Complete!"
    echo -e "${GREEN}All benchmarks finished successfully!${NC}"
    echo ""
}

main "$@"
