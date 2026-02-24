#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SelfDB Backup Script (CLI)
# ─────────────────────────────────────────────────────────────────────────────
# 
# Creates a full backup of SelfDB including:
# - PostgreSQL database dump
# - Storage files (uploaded files)
# - .env configuration file
#
# This script is decoupled from the backend for faster performance.
#
# Usage:
#   ./backup_now.sh                    # Create backup with auto-generated name
#   ./backup_now.sh --name mybackup    # Create backup with custom name suffix
#   ./backup_now.sh --list             # List existing backups
#   ./backup_now.sh --cleanup          # Delete backups older than retention period
#   ./backup_now.sh --help             # Show help
#
# ─────────────────────────────────────────────────────────────────────────────

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get script directory (where docker-compose.yml should be)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/backups"

# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

print_header() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  SelfDB Backup Tool (CLI)${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

show_help() {
    echo "SelfDB Backup Tool - Create database and storage backups"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --name <suffix>   Add custom suffix to backup filename"
    echo "  --list            List all available backups"
    echo "  --cleanup         Delete backups older than retention period"
    echo "  --retention <days> Set retention days for cleanup (default: from .env or 7)"
    echo "  --help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                          # Create backup: selfdb_backup_20251205_143022.tar.gz"
    echo "  $0 --name pre-migration     # Create backup: selfdb_backup_20251205_143022_pre-migration.tar.gz"
    echo "  $0 --list                   # Show all backups with sizes and dates"
    echo "  $0 --cleanup                # Remove old backups based on retention policy"
    echo "  $0 --cleanup --retention 14 # Remove backups older than 14 days"
    echo ""
}

list_backups() {
    echo -e "${BLUE}Available backups in ./backups/:${NC}"
    echo ""
    
    if [ ! -d "$BACKUP_DIR" ]; then
        print_warning "Backup directory not found: $BACKUP_DIR"
        exit 0
    fi
    
    # Find and list backups sorted by date (newest first)
    local backups=$(ls -t "$BACKUP_DIR"/selfdb_backup_*.tar.gz 2>/dev/null)
    
    if [ -z "$backups" ]; then
        print_warning "No backup files found."
        exit 0
    fi
    
    echo "  #  | Filename                                        | Size      | Date"
    echo "-----+-------------------------------------------------+-----------+-------------------"
    
    local count=1
    local total_size=0
    while IFS= read -r backup; do
        local filename=$(basename "$backup")
        local size_bytes=$(stat -f%z "$backup" 2>/dev/null || stat -c%s "$backup" 2>/dev/null)
        local size=$(du -h "$backup" | cut -f1)
        total_size=$((total_size + size_bytes))
        
        # Extract date from filename
        local date_part=$(echo "$filename" | sed -E 's/selfdb_backup_([0-9]{8})_([0-9]{6}).*\.tar\.gz/\1 \2/')
        local formatted_date=$(echo "$date_part" | sed -E 's/([0-9]{4})([0-9]{2})([0-9]{2}) ([0-9]{2})([0-9]{2})([0-9]{2})/\1-\2-\3 \4:\5:\6/')
        
        printf "  %-2s | %-47s | %-9s | %s\n" "$count" "$filename" "$size" "$formatted_date"
        count=$((count + 1))
    done <<< "$backups"
    
    echo ""
    # Convert total size to human readable
    if [ $total_size -gt 1073741824 ]; then
        echo -e "Total: $((count - 1)) backups, $(echo "scale=2; $total_size/1073741824" | bc)G"
    elif [ $total_size -gt 1048576 ]; then
        echo -e "Total: $((count - 1)) backups, $(echo "scale=2; $total_size/1048576" | bc)M"
    else
        echo -e "Total: $((count - 1)) backups, $(echo "scale=2; $total_size/1024" | bc)K"
    fi
}

cleanup_backups() {
    local retention_days=$1
    
    print_info "Cleaning up backups older than $retention_days days..."
    
    if [ ! -d "$BACKUP_DIR" ]; then
        print_warning "Backup directory not found"
        return
    fi
    
    local deleted=0
    local cutoff_timestamp=$(date -v-${retention_days}d +%Y%m%d%H%M%S 2>/dev/null || date -d "$retention_days days ago" +%Y%m%d%H%M%S 2>/dev/null)
    
    for backup in "$BACKUP_DIR"/selfdb_backup_*.tar.gz; do
        [ -f "$backup" ] || continue
        
        local filename=$(basename "$backup")
        # Extract timestamp: selfdb_backup_YYYYMMDD_HHMMSS[_suffix].tar.gz
        local backup_timestamp=$(echo "$filename" | sed -E 's/selfdb_backup_([0-9]{8})_([0-9]{6}).*\.tar\.gz/\1\2/')
        
        if [ "$backup_timestamp" -lt "$cutoff_timestamp" ] 2>/dev/null; then
            echo "  Deleting: $filename"
            rm "$backup"
            deleted=$((deleted + 1))
        fi
    done
    
    if [ $deleted -eq 0 ]; then
        print_info "No old backups to delete"
    else
        print_success "Deleted $deleted old backup(s)"
    fi
}

load_env() {
    # Load specific environment variables we need
    if [ -f "$SCRIPT_DIR/.env" ]; then
        POSTGRES_USER=$(grep -E '^POSTGRES_USER=' "$SCRIPT_DIR/.env" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
        POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' "$SCRIPT_DIR/.env" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
        POSTGRES_DB=$(grep -E '^POSTGRES_DB=' "$SCRIPT_DIR/.env" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
        BACKUP_RETENTION_DAYS=$(grep -E '^BACKUP_RETENTION_DAYS=' "$SCRIPT_DIR/.env" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
    fi
    
    # Set defaults if not in .env
    POSTGRES_USER="${POSTGRES_USER:-postgres}"
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
    POSTGRES_DB="${POSTGRES_DB:-selfdb}"
    BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Main Backup Function
# ─────────────────────────────────────────────────────────────────────────────

create_backup() {
    local name_suffix="$1"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_filename="selfdb_backup_${timestamp}"
    
    if [ -n "$name_suffix" ]; then
        # Sanitize suffix (remove special chars except dash and underscore)
        name_suffix=$(echo "$name_suffix" | tr -cd 'a-zA-Z0-9_-')
        backup_filename="${backup_filename}_${name_suffix}"
    fi
    
    backup_filename="${backup_filename}.tar.gz"
    local backup_path="$BACKUP_DIR/$backup_filename"
    
    # Create temp directory
    local temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT
    
    local temp_backup_dir="$temp_dir/backup_${timestamp}"
    mkdir -p "$temp_backup_dir"
    
    echo ""
    print_info "Creating backup: $backup_filename"
    echo ""
    
    # ─────────────────────────────────────────────────────────────────────────
    # Step 1: Database dump using pg_dump via Docker
    # ─────────────────────────────────────────────────────────────────────────
    
    print_info "Step 1/4: Dumping PostgreSQL database..."
    
    local start_time=$(date +%s)
    
    # Check if db container is running
    if ! docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps --status running | grep -q "db"; then
        print_error "Database container is not running. Start it with: docker compose up -d db"
        exit 1
    fi
    
    # Wait for database to be ready
    for i in {1..10}; do
        if docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" > /dev/null 2>&1; then
            break
        fi
        if [ $i -eq 10 ]; then
            print_error "Database is not ready"
            exit 1
        fi
        sleep 1
    done
    
    # Run pg_dump inside the container
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T db pg_dump \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        > "$temp_backup_dir/database.sql" 2>/dev/null
    
    if [ $? -ne 0 ] || [ ! -s "$temp_backup_dir/database.sql" ]; then
        print_error "Failed to dump database"
        exit 1
    fi
    
    local db_size=$(du -h "$temp_backup_dir/database.sql" | cut -f1)
    print_success "Database dumped ($db_size)"
    
    # ─────────────────────────────────────────────────────────────────────────
    # Step 2: Copy .env file
    # ─────────────────────────────────────────────────────────────────────────
    
    print_info "Step 2/4: Copying .env configuration..."
    
    if [ -f "$SCRIPT_DIR/.env" ]; then
        cp "$SCRIPT_DIR/.env" "$temp_backup_dir/.env"
        print_success ".env file included"
    else
        print_warning ".env file not found (skipping)"
    fi
    
    # ─────────────────────────────────────────────────────────────────────────
    # Step 3: Copy storage data from Docker volume
    # ─────────────────────────────────────────────────────────────────────────
    
    print_info "Step 3/4: Copying storage files..."
    
    local storage_backup_dir="$temp_backup_dir/storage"
    mkdir -p "$storage_backup_dir"
    
    # Check if storage container is running
    if docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps --status running | grep -q "storage"; then
        # First check if there are any files and get size estimate
        local file_count=$(docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T storage sh -c 'find /data -type f 2>/dev/null | wc -l' 2>/dev/null | tr -d '[:space:]')
        local storage_size_estimate=$(docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T storage sh -c 'du -sh /data 2>/dev/null | cut -f1' 2>/dev/null | tr -d '[:space:]')
        
        if [ "$file_count" -gt 0 ] 2>/dev/null; then
            print_info "Found $file_count files ($storage_size_estimate) - streaming from container..."
            
            # Use tar streaming for efficient large file transfer (faster than docker cp for large datasets)
            local storage_container=$(docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps -q storage)
            
            # Stream tar from container directly - much faster for large files
            docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T storage tar -cf - -C /data . 2>/dev/null | tar --no-xattrs -xf - -C "$storage_backup_dir/" 2>/dev/null
            
            if [ $? -eq 0 ]; then
                local storage_size=$(du -sh "$storage_backup_dir" 2>/dev/null | cut -f1)
                print_success "Storage files copied ($file_count files, $storage_size)"
            else
                # Fallback to docker cp if tar streaming fails
                print_warning "Tar streaming failed, using fallback method..."
                docker cp "$storage_container:/data/." "$storage_backup_dir/" 2>/dev/null || true
                local storage_size=$(du -sh "$storage_backup_dir" 2>/dev/null | cut -f1)
                print_success "Storage files copied via fallback ($storage_size)"
            fi
        else
            print_info "No storage files to backup"
            rmdir "$storage_backup_dir" 2>/dev/null || true
        fi
    else
        print_warning "Storage container not running (skipping storage backup)"
        rmdir "$storage_backup_dir" 2>/dev/null || true
    fi
    
    # ─────────────────────────────────────────────────────────────────────────
    # Step 4: Create tar.gz archive
    # ─────────────────────────────────────────────────────────────────────────
    
    print_info "Step 4/4: Creating compressed archive..."
    
    # Ensure backup directory exists
    mkdir -p "$BACKUP_DIR"
    
    # Create tar.gz archive
    tar -czf "$backup_path" -C "$temp_backup_dir" .
    
    if [ $? -ne 0 ]; then
        print_error "Failed to create archive"
        exit 1
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    local final_size=$(du -h "$backup_path" | cut -f1)
    
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✓ Backup completed successfully!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${CYAN}Filename:${NC}  $backup_filename"
    echo -e "  ${CYAN}Size:${NC}      $final_size"
    echo -e "  ${CYAN}Duration:${NC}  ${duration}s"
    echo -e "  ${CYAN}Location:${NC}  $backup_path"
    echo ""
    echo -e "  ${CYAN}Contents:${NC}"
    echo "    - database.sql (PostgreSQL dump)"
    [ -f "$temp_backup_dir/.env" ] && echo "    - .env (configuration)"
    [ -d "$temp_backup_dir/storage" ] && [ "$(ls -A $temp_backup_dir/storage 2>/dev/null)" ] && echo "    - storage/ (uploaded files)"
    echo ""
    echo "To restore this backup, run:"
    echo "  ./restore_from_backup.sh $backup_filename"
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Parse Arguments
# ─────────────────────────────────────────────────────────────────────────────

print_header

# Check if docker is available
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed or not in PATH"
    exit 1
fi

# Load environment variables
load_env

# Change to script directory
cd "$SCRIPT_DIR"

# Check if docker-compose.yml exists
if [ ! -f "docker-compose.yml" ]; then
    print_error "docker-compose.yml not found in $SCRIPT_DIR"
    exit 1
fi

# Parse arguments
NAME_SUFFIX=""
RETENTION_OVERRIDE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_help
            exit 0
            ;;
        --list|-l)
            list_backups
            exit 0
            ;;
        --cleanup|-c)
            CLEANUP_MODE=true
            shift
            ;;
        --retention|-r)
            RETENTION_OVERRIDE="$2"
            shift 2
            ;;
        --name|-n)
            NAME_SUFFIX="$2"
            shift 2
            ;;
        *)
            print_error "Unknown option: $1"
            echo ""
            show_help
            exit 1
            ;;
    esac
done

# Handle cleanup mode
if [ "$CLEANUP_MODE" = true ]; then
    retention="${RETENTION_OVERRIDE:-$BACKUP_RETENTION_DAYS}"
    cleanup_backups "$retention"
    exit 0
fi

# Default: create backup
create_backup "$NAME_SUFFIX"
