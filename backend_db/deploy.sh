#!/usr/bin/env bash

# ═══════════════════════════════════════════════════════════════════════════════
# SelfDB Production Deploy Script
# ═══════════════════════════════════════════════════════════════════════════════
#
# Deploys SelfDB to a remote production server via SSH.
# Supports two modes: init (first-time) and redeploy (updates).
#
# Usage:
#   ./deploy.sh                              # Interactive wizard
#   ./deploy.sh --host 1.2.3.4 --user root   # With flags
#   ./deploy.sh --help                       # Show help
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "$0")"
VERSION="1.0.0"

# Defaults
DEFAULT_USER="root"
DEFAULT_PORT="22"
DEFAULT_REMOTE_DIR="Desktop/SelfDB"

# State
HOST=""
USER="$DEFAULT_USER"
SSH_KEY=""
SSH_PORT="$DEFAULT_PORT"
USE_PASSWORD=false
SSH_PASSWORD=""
SKIP_CONFIRM=true
DRY_RUN=false
DEPLOY_MODE=""  # "init" or "redeploy" - auto-detected

# Temp files
TARBALL=""
DEPLOY_LOG=""
TEMP_SSH_KEY=""

# ─────────────────────────────────────────────────────────────────────────────
# Colors
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─────────────────────────────────────────────────────────────────────────────
# Output helpers
# ─────────────────────────────────────────────────────────────────────────────

print_banner() {
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}  ${BOLD}🚀 SelfDB Deploy${NC}                                            ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  ${DIM}Deploy SelfDB to production with one command${NC}                ${BLUE}║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    local step=$1
    local total=$2
    local message=$3
    printf "${CYAN}[%d/%d]${NC} %s " "$step" "$total" "$message"
}

print_pass() {
    echo -e "${GREEN}PASS${NC}"
}

print_fail() {
    echo -e "${RED}FAIL${NC}"
}

print_skip() {
    local reason=${1:-""}
    if [ -n "$reason" ]; then
        echo -e "${YELLOW}SKIP${NC} ${DIM}($reason)${NC}"
    else
        echo -e "${YELLOW}SKIP${NC}"
    fi
}

print_dots() {
    local message=$1
    local total_width=50
    local msg_len=${#message}
    local dots_needed=$((total_width - msg_len))
    printf "%s" "$message"
    printf '%*s' "$dots_needed" '' | tr ' ' '.'
    printf " "
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# ─────────────────────────────────────────────────────────────────────────────
# Error handling with helpful messages
# ─────────────────────────────────────────────────────────────────────────────

fail_with_help() {
    local step=$1
    local total=$2
    local reason=$3
    local help_message=$4
    
    print_fail
    echo ""
    echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}  ❌ Deployment failed at step $step/$total${NC}"
    echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BOLD}Reason:${NC} $reason"
    echo ""
    echo -e "${BOLD}How to fix:${NC}"
    echo -e "$help_message"
    echo ""
    echo -e "${GREEN}Your running containers are safe — nothing was changed.${NC}"
    echo ""
    
    cleanup
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────────────────────────────────────────

cleanup() {
    if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
        rm -f "$TARBALL"
    fi
    if [ -n "$TEMP_SSH_KEY" ] && [ -f "$TEMP_SSH_KEY" ]; then
        rm -f "$TEMP_SSH_KEY"
    fi
}

trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────────
# Local .env helper (for printing friendly URLs)
# ─────────────────────────────────────────────────────────────────────────────

read_env_var() {
    local key="$1"
    local env_file="${SCRIPT_DIR}/.env"

    [ -f "$env_file" ] || return 1

    # Read the last occurrence of KEY=... (allows overrides later in file).
    # Strips optional surrounding quotes.
    local value
    value=$(grep -E "^[[:space:]]*${key}=" "$env_file" | tail -n 1 | sed -E "s/^[[:space:]]*${key}=//" | sed -E 's/^"(.*)"$/\1/' | sed -E "s/^'(.*)'$/\1/")

    [ -n "${value}" ] || return 1
    printf '%s' "$value"
}

# ─────────────────────────────────────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────────────────────────────────────

show_help() {
    echo "SelfDB Deploy Script v${VERSION}"
    echo ""
    echo "Deploy SelfDB to a production server via SSH."
    echo ""
    echo -e "${BOLD}Usage:${NC}"
    echo "  $SCRIPT_NAME                     Interactive wizard (recommended)"
    echo "  $SCRIPT_NAME [OPTIONS]           With command-line flags"
    echo ""
    echo -e "${BOLD}Options:${NC}"
    echo "  --host <ip>       Server IP or hostname (required)"
    echo "  --user <name>     SSH username (default: root)"
    echo "  --key <path>      Path to SSH private key"
    echo "  --password        Use password authentication"
    echo "  --port <num>      SSH port (default: 22)"
    echo "  --yes             Skip confirmation prompts"
    echo "  --dry-run         Show what would happen without doing it"
    echo "  --help            Show this help message"
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo "  $SCRIPT_NAME"
    echo "  $SCRIPT_NAME --host 192.168.1.50 --user root --yes"
    echo "  $SCRIPT_NAME --host myserver.com --key ~/.ssh/id_ed25519"
    echo "  $SCRIPT_NAME --host 10.0.0.5 --dry-run"
    echo ""
    echo -e "${BOLD}What it does:${NC}"
    echo "  1. Packages the SelfDB repo"
    echo "  2. Uploads to your server via rsync"
    echo "  3. Installs Docker if needed (first deploy only)"
    echo "  4. Configures firewall (first deploy only)"
    echo "  5. Starts SelfDB with Caddy reverse proxy on port 80"
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Parse arguments
# ─────────────────────────────────────────────────────────────────────────────

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --host)
                HOST="$2"
                shift 2
                ;;
            --user)
                USER="$2"
                shift 2
                ;;
            --ssh-key)
                # Auto-detect: file path or key content
                if [ -f "$2" ]; then
                    # It's a file path
                    SSH_KEY="$2"
                else
                    # It's key content - write to temp file
                    TEMP_SSH_KEY=$(mktemp)
                    echo "$2" > "$TEMP_SSH_KEY"
                    chmod 600 "$TEMP_SSH_KEY"
                    SSH_KEY="$TEMP_SSH_KEY"
                fi
                shift 2
                ;;
            --password)
                USE_PASSWORD=true
                SSH_PASSWORD="$2"
                shift 2
                ;;
            --port)
                SSH_PORT="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                echo ""
                show_help
                exit 1
                ;;
        esac
    done
}

# ─────────────────────────────────────────────────────────────────────────────
# Interactive wizard
# ─────────────────────────────────────────────────────────────────────────────

run_wizard() {
    echo -e "${BOLD}Let's deploy SelfDB to your server!${NC}"
    echo ""
    
    # Host (required)
    if [ -z "$HOST" ]; then
        read -p "Server IP or hostname: " HOST
        if [ -z "$HOST" ]; then
            print_error "Server host is required"
            exit 1
        fi
    fi
    
    # User
    read -p "SSH username [${DEFAULT_USER}]: " input_user
    USER="${input_user:-$DEFAULT_USER}"
    
    # SSH key auto-detection
    if [ -z "$SSH_KEY" ] && [ "$USE_PASSWORD" = false ]; then
        # Try common key locations
        for key_path in ~/.ssh/id_ed25519 ~/.ssh/id_rsa ~/.ssh/id_ecdsa; do
            if [ -f "$key_path" ]; then
                SSH_KEY="$key_path"
                break
            fi
        done
        
        if [ -n "$SSH_KEY" ]; then
            read -p "SSH key path [${SSH_KEY}]: " input_key
            SSH_KEY="${input_key:-$SSH_KEY}"
        else
            read -p "SSH key path (or press Enter for password): " SSH_KEY
            if [ -z "$SSH_KEY" ]; then
                USE_PASSWORD=true
            fi
        fi
    fi
    
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# SSH helpers
# ─────────────────────────────────────────────────────────────────────────────

build_ssh_opts() {
    local opts="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
    opts="$opts -p $SSH_PORT"
    
    if [ -n "$SSH_KEY" ]; then
        opts="$opts -i $SSH_KEY"
    fi
    
    echo "$opts"
}

run_ssh() {
    local cmd=$1
    local ssh_opts
    ssh_opts=$(build_ssh_opts)
    
    if [ "$DRY_RUN" = true ]; then
        if [ -n "$SSH_PASSWORD" ]; then
            echo -e "${DIM}[DRY-RUN] sshpass -p '***' ssh $ssh_opts ${USER}@${HOST} \"$cmd\"${NC}"
        else
            echo -e "${DIM}[DRY-RUN] ssh $ssh_opts ${USER}@${HOST} \"$cmd\"${NC}"
        fi
        return 0
    fi
    
    # shellcheck disable=SC2086
    if [ -n "$SSH_PASSWORD" ]; then
        sshpass -p "$SSH_PASSWORD" ssh $ssh_opts "${USER}@${HOST}" "$cmd"
    else
        ssh $ssh_opts "${USER}@${HOST}" "$cmd"
    fi
}

run_ssh_quiet() {
    local cmd=$1
    local ssh_opts
    ssh_opts=$(build_ssh_opts)
    
    if [ "$DRY_RUN" = true ]; then
        return 0
    fi
    
    # shellcheck disable=SC2086
    if [ -n "$SSH_PASSWORD" ]; then
        sshpass -p "$SSH_PASSWORD" ssh $ssh_opts "${USER}@${HOST}" "$cmd" 2>/dev/null
    else
        ssh $ssh_opts "${USER}@${HOST}" "$cmd" 2>/dev/null
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Local checks
# ─────────────────────────────────────────────────────────────────────────────

check_local_requirements() {
    print_step 1 7 ""
    print_dots "Checking local requirements"
    
    local missing=()
    
    # Check we're in SelfDB repo
    if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ] || [ ! -f "$SCRIPT_DIR/selfdb.sh" ]; then
        fail_with_help 1 7 \
            "Not in SelfDB repository root" \
            "  1. Make sure you're running this script from the SelfDB folder
  2. The folder should contain docker-compose.yml and selfdb.sh"
    fi
    
    # Check required tools
    for tool in ssh rsync tar; do
        if ! command -v "$tool" &>/dev/null; then
            missing+=("$tool")
        fi
    done
    
    if [ ${#missing[@]} -ne 0 ]; then
        fail_with_help 1 7 \
            "Missing required tools: ${missing[*]}" \
            "  Install the missing tools:
  - macOS: brew install ${missing[*]}
  - Ubuntu: sudo apt install ${missing[*]}"
    fi
    
    # Check production compose exists
    if [ ! -f "$SCRIPT_DIR/docker-compose-production.yml" ]; then
        fail_with_help 1 7 \
            "Missing docker-compose-production.yml" \
            "  The production Docker Compose file is required for deployment.
  Make sure you have the complete SelfDB repository."
    fi
    
    # Check Caddyfile exists
    if [ ! -f "$SCRIPT_DIR/caddy/Caddyfile" ]; then
        fail_with_help 1 7 \
            "Missing caddy/Caddyfile" \
            "  The Caddy configuration file is required for deployment.
  Make sure you have the complete SelfDB repository."
    fi
    
    print_pass
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Connect to server
# ─────────────────────────────────────────────────────────────────────────────

check_ssh_connection() {
    print_step 2 7 ""
    print_dots "Connecting to server"
    
    if [ "$DRY_RUN" = true ]; then
        print_pass
        return 0
    fi
    
    # Test SSH connection
    if ! run_ssh_quiet "echo ok" ; then
        fail_with_help 2 7 \
            "SSH connection failed" \
            "  1. Check your server IP/hostname: ${HOST}
  2. Check your username: ${USER}
  3. Check your SSH key: ${SSH_KEY:-'(using password)'}
  4. Try manually: ssh ${USER}@${HOST}
  5. If using key auth, try: ssh-copy-id ${USER}@${HOST}"
    fi
    
    # Check disk space (need at least 2GB free)
    local free_space
    free_space=$(run_ssh "df -BG /home 2>/dev/null | tail -1 | awk '{print \$4}' | tr -d 'G'" || echo "0")
    
    if [ "${free_space:-0}" -lt 2 ]; then
        print_warning "Low disk space on server (${free_space}GB free)"
    fi
    
    # Detect if SelfDB is already deployed
    if run_ssh_quiet "[ -d /home/${USER}/${DEFAULT_REMOTE_DIR} ]"; then
        DEPLOY_MODE="redeploy"
    else
        DEPLOY_MODE="init"
    fi
    
    print_pass
    print_info "Detected mode: ${BOLD}${DEPLOY_MODE}${NC}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Install Docker (init mode only)
# ─────────────────────────────────────────────────────────────────────────────

install_docker() {
    print_step 3 7 ""
    print_dots "Installing Docker"
    
    if [ "$DEPLOY_MODE" = "redeploy" ]; then
        print_skip "redeploy mode"
        return 0
    fi
    
    if [ "$DRY_RUN" = true ]; then
        echo -e "${DIM}[DRY-RUN] Would install Docker if not present${NC}"
        print_pass
        return 0
    fi
    
    # Check if Docker is already installed
    if run_ssh_quiet "command -v docker &>/dev/null"; then
        print_skip "already installed"
        return 0
    fi
    
    # Install Docker using official script
    run_ssh "curl -fsSL https://get.docker.com | sh" || {
        fail_with_help 3 7 \
            "Failed to install Docker" \
            "  1. SSH into your server: ssh ${USER}@${HOST}
  2. Install Docker manually: curl -fsSL https://get.docker.com | sh
  3. Run deploy again"
    }
    
    # Add user to docker group
    run_ssh "sudo usermod -aG docker ${USER}" || true
    
    print_pass
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 3.5: Configure firewall (init mode only)
# ─────────────────────────────────────────────────────────────────────────────

configure_firewall() {
    if [ "$DEPLOY_MODE" = "redeploy" ]; then
        return 0
    fi
    
    if [ "$DRY_RUN" = true ]; then
        return 0
    fi
    
    # Check if UFW is available
    if ! run_ssh_quiet "command -v ufw &>/dev/null"; then
        return 0
    fi
    
    # Configure UFW (silently)
    run_ssh "sudo ufw allow 22/tcp comment 'SSH' 2>/dev/null || true"
    run_ssh "sudo ufw allow 80/tcp comment 'HTTP' 2>/dev/null || true"
    run_ssh "sudo ufw allow 443/tcp comment 'HTTPS' 2>/dev/null || true"
    run_ssh "sudo ufw --force enable 2>/dev/null || true"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 3.6: Install and configure fail2ban (init mode only)
# ─────────────────────────────────────────────────────────────────────────────

install_fail2ban() {
    if [ "$DEPLOY_MODE" = "redeploy" ]; then
        return 0
    fi
    
    if [ "$DRY_RUN" = true ]; then
        return 0
    fi
    
    # Check if fail2ban is already installed
    if run_ssh_quiet "command -v fail2ban-client &>/dev/null"; then
        return 0
    fi
    
    # Install fail2ban (works on Debian/Ubuntu)
    run_ssh "sudo apt-get update -qq && sudo apt-get install -y -qq fail2ban" 2>/dev/null || {
        # Try yum for CentOS/RHEL
        run_ssh "sudo yum install -y epel-release && sudo yum install -y fail2ban" 2>/dev/null || true
    }
    
    # Create jail.local configuration for SSH protection
    run_ssh "sudo tee /etc/fail2ban/jail.local > /dev/null << 'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
findtime = 10m
bantime = 24h
EOF"
    
    # Start and enable fail2ban
    run_ssh "sudo systemctl enable fail2ban 2>/dev/null || true"
    run_ssh "sudo systemctl start fail2ban 2>/dev/null || true"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Package and upload
# ─────────────────────────────────────────────────────────────────────────────

package_and_upload() {
    print_step 4 7 ""
    print_dots "Uploading SelfDB"
    
    local remote_dir="/home/${USER}/${DEFAULT_REMOTE_DIR}"
    
    if [ "$DRY_RUN" = true ]; then
        echo -e "${DIM}[DRY-RUN] Would upload to ${remote_dir}${NC}"
        print_pass
        return 0
    fi
    
    # Create remote directory
    run_ssh "mkdir -p ${remote_dir}"
    
    # Build rsync options
    local rsync_opts="-az --progress --delete"
    rsync_opts="$rsync_opts --exclude='.git'"
    rsync_opts="$rsync_opts --exclude='node_modules'"
    rsync_opts="$rsync_opts --exclude='__pycache__'"
    rsync_opts="$rsync_opts --exclude='.pytest_cache'"
    rsync_opts="$rsync_opts --exclude='*.pyc'"
    rsync_opts="$rsync_opts --exclude='.env.local'"
    rsync_opts="$rsync_opts --exclude='backups/*'"
    rsync_opts="$rsync_opts --exclude='.venv'"
    rsync_opts="$rsync_opts --exclude='dist'"
    rsync_opts="$rsync_opts --exclude='build'"
    
    # SSH options for rsync
    local ssh_cmd="ssh -o StrictHostKeyChecking=accept-new -p ${SSH_PORT}"
    if [ -n "$SSH_KEY" ]; then
        ssh_cmd="$ssh_cmd -i ${SSH_KEY}"
    fi
    # Use fast cipher for better transfer speed
    ssh_cmd="$ssh_cmd -o Compression=no -c aes128-gcm@openssh.com"
    
    # Run rsync (capture output for size info)
    local rsync_output
    # shellcheck disable=SC2086
    rsync_output=$(rsync $rsync_opts -e "$ssh_cmd" \
        "${SCRIPT_DIR}/" \
        "${USER}@${HOST}:${remote_dir}/" 2>&1) || {
        fail_with_help 4 7 \
            "Failed to upload files" \
            "  1. Check your network connection
  2. Check disk space on server
  3. Try again: ./deploy.sh"
    }
    
    print_pass
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Start the stack
# ─────────────────────────────────────────────────────────────────────────────

start_stack() {
    print_step 5 7 ""
    print_dots "Starting stack"
    
    local remote_dir="/home/${USER}/${DEFAULT_REMOTE_DIR}"
    
    if [ "$DRY_RUN" = true ]; then
        if [ "${DEPLOY_MODE}" = "redeploy" ]; then
            echo -e "${DIM}[DRY-RUN] Would run: docker compose -f docker-compose-production.yml build --no-cache && docker compose -f docker-compose-production.yml up -d${NC}"
        else
            echo -e "${DIM}[DRY-RUN] Would run: docker compose -f docker-compose-production.yml up -d --build${NC}"
        fi
        print_pass
        return 0
    fi
    
    # Create logs directory
    run_ssh "mkdir -p ${remote_dir}/logs"
    
    # Create backups directory
    run_ssh "mkdir -p ${remote_dir}/backups"
    
    # Pull and start containers
    run_ssh "cd ${remote_dir} && docker compose -f docker-compose-production.yml pull 2>/dev/null || true"

    # In redeploy mode, rebuild without cache to ensure changes are picked up
    if [ "${DEPLOY_MODE}" = "redeploy" ]; then
        run_ssh "cd ${remote_dir} && docker compose -f docker-compose-production.yml build --no-cache" || {
            fail_with_help 5 7 \
                "Failed to rebuild Docker images (no-cache)" \
                "  1. SSH into your server: ssh ${USER}@${HOST}
  2. Check logs/status: cd ~/${DEFAULT_REMOTE_DIR} && docker compose -f docker-compose-production.yml ps
  3. Try rebuilding manually: docker compose -f docker-compose-production.yml build --no-cache"
        }
        run_ssh "cd ${remote_dir} && docker compose -f docker-compose-production.yml up -d" || {
            fail_with_help 5 7 \
                "Failed to start Docker containers" \
                "  1. SSH into your server: ssh ${USER}@${HOST}
  2. Check logs: cd ~/${DEFAULT_REMOTE_DIR} && docker compose -f docker-compose-production.yml logs
  3. Check .env file exists and is configured
  4. Try starting manually: docker compose -f docker-compose-production.yml up -d"
        }
        print_pass
        return 0
    fi

    # Default behavior (init mode): build using cache
    run_ssh "cd ${remote_dir} && docker compose -f docker-compose-production.yml up -d --build" || {
        fail_with_help 5 7 \
            "Failed to start Docker containers" \
            "  1. SSH into your server: ssh ${USER}@${HOST}
  2. Check logs: cd ~/${DEFAULT_REMOTE_DIR} && docker compose -f docker-compose-production.yml logs
  3. Check .env file exists and is configured
  4. Try starting manually: docker compose -f docker-compose-production.yml up -d"
    }
    
    print_pass
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: Health checks
# ─────────────────────────────────────────────────────────────────────────────

run_health_checks() {
    print_step 6 7 ""
    print_dots "Health checks"
    
    if [ "$DRY_RUN" = true ]; then
        print_pass
        return 0
    fi
    
    # Wait for services to start
    sleep 5
    
    # Check if Caddy is responding
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if run_ssh_quiet "curl -sf http://localhost:80/ >/dev/null 2>&1"; then
            print_pass
            return 0
        fi
        sleep 2
        attempt=$((attempt + 1))
    done
    
    # If we get here, health check failed but containers might still be starting
    print_warning "Services may still be starting"
    print_info "Check status: ssh ${USER}@${HOST} 'cd ~/${DEFAULT_REMOTE_DIR} && docker compose -f docker-compose-production.yml ps'"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 7: Prune unused SelfDB containers/images (best-effort)
# ─────────────────────────────────────────────────────────────────────────────

prune_selfdb_resources() {
        print_step 7 7 ""
        print_dots "Pruning unused SelfDB Docker resources"

        local remote_dir="/home/${USER}/${DEFAULT_REMOTE_DIR}"

        if [ "$DRY_RUN" = true ]; then
                echo -e "${DIM}[DRY-RUN] Would run: docker container prune/image prune filtered to this compose project${NC}"
                print_pass
                return 0
        fi

        # Use the known project name from docker-compose-production.yml (name: selfdb)
        local project="selfdb"
        local cmd
        cmd=$'cd "'"${remote_dir}"'" && \
docker container prune --force --filter "label=com.docker.compose.project='"${project}"'"; \
docker image prune --all --force --filter "label=com.docker.compose.project='"${project}"'"'

        # Best-effort: don't fail the deployment if prune fails.
        if ! run_ssh_quiet "$cmd"; then
                print_skip "prune failed (non-fatal)"
                print_info "You can prune manually: ssh ${USER}@${HOST} 'cd ~/${DEFAULT_REMOTE_DIR} && docker container prune -f --filter label=com.docker.compose.project=<project>'"
                return 0
        fi

        print_pass
}

# ─────────────────────────────────────────────────────────────────────────────
# Pre-run checklist
# ─────────────────────────────────────────────────────────────────────────────

show_checklist() {
    local remote_dir="/home/${USER}/${DEFAULT_REMOTE_DIR}"
    
    echo ""
    echo -e "${BOLD}Pre-deploy checklist:${NC}"
    echo ""
    echo -e "  ${GREEN}✓${NC} Local: SelfDB repo detected"
    echo -e "  ${GREEN}✓${NC} Local: ssh, tar, rsync installed"
    echo -e "  ${CYAN}→${NC} Remote: Connect to ${USER}@${HOST}"
    echo -e "  ${CYAN}→${NC} Remote: Install Docker (if needed)"
    echo -e "  ${CYAN}→${NC} Remote: Configure firewall (ports 22, 80, 443)"
    echo -e "  ${CYAN}→${NC} Remote: Deploy to ${remote_dir}"
    echo ""
    
    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}DRY-RUN MODE: No changes will be made${NC}"
        echo ""
    fi
    
    if [ "$SKIP_CONFIRM" = false ]; then
        read -p "Continue? (y/n) " confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            echo "Deployment cancelled."
            exit 0
        fi
    fi
    
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Success summary
# ─────────────────────────────────────────────────────────────────────────────

show_success() {
    local remote_dir="~/${DEFAULT_REMOTE_DIR}"
    local frontend_domain=""

    frontend_domain=$(read_env_var FRONTEND_DOMAIN 2>/dev/null || true)
    
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ SelfDB is live!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    # Prefer the configured frontend domain (Auto HTTPS), fall back to server host/IP.
    if [ -n "$frontend_domain" ]; then
        echo -e "  ${CYAN}🌐 Open in browser:${NC}  https://${frontend_domain}"
    else
        echo -e "  ${CYAN}🌐 Open in browser:${NC}  http://${HOST}"
    fi
    echo -e "  ${CYAN}📊 View logs:${NC}        ssh ${USER}@${HOST} \"cd ${remote_dir} && docker compose -f docker-compose-production.yml logs -f\""
    echo -e "  ${CYAN}🔄 Redeploy:${NC}         ./deploy.sh --host ${HOST} --user ${USER} --ssh-key <your-ssh-key>"
    echo -e "  ${CYAN}💾 Backups at:${NC}       ${remote_dir}/backups/"
    echo -e "  ${CYAN}🛠️  Manual control:${NC}   ssh ${USER}@${HOST} \"cd ${remote_dir} && docker compose -f docker-compose-production.yml\""
    echo ""
    echo -e "  ${DIM}Need help? https://github.com/selfdb/selfdb${NC}"
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

main() {
    parse_args "$@"
    
    print_banner
    
    # Run wizard if host not provided
    if [ -z "$HOST" ]; then
        run_wizard
    fi
    
    # Validate host
    if [ -z "$HOST" ]; then
        print_error "Server host is required"
        echo ""
        show_help
        exit 1
    fi
    
    # Quick local check before showing checklist
    if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
        print_error "Not in SelfDB repository root"
        exit 1
    fi
    
    show_checklist
    
    echo -e "${BOLD}Starting deployment...${NC}"
    echo ""
    
    # Run deployment steps
    check_local_requirements
    check_ssh_connection
    install_docker
    configure_firewall
    install_fail2ban
    package_and_upload
    start_stack
    run_health_checks
    prune_selfdb_resources
    
    if [ "$DRY_RUN" = true ]; then
        echo ""
        echo -e "${YELLOW}DRY-RUN complete. No changes were made.${NC}"
        echo ""
    else
        show_success
    fi
}

main "$@"
