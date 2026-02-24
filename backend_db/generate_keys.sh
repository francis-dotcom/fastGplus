#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# SelfDB Key Generator
# Generates secure SECRET_KEY and API_KEY for the .env file
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get script directory and .env path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

echo -e "${CYAN}"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "                        SelfDB Key Generator"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo -e "${NC}"

# Check if .env file exists
if [[ ! -f "$ENV_FILE" ]]; then
    echo -e "${RED}Error: .env file not found at ${ENV_FILE}${NC}"
    exit 1
fi

# Function to generate a secure SECRET_KEY (64 hex characters)
generate_secret_key() {
    openssl rand -hex 32
}

# Function to generate a secure API_KEY with selfdb prefix
# Format: selfdb-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX (similar to UUID, ~45 chars)
generate_api_key() {
    local seg1=$(openssl rand -hex 4)  # 8 chars
    local seg2=$(openssl rand -hex 2)  # 4 chars
    local seg3=$(openssl rand -hex 2)  # 4 chars
    local seg4=$(openssl rand -hex 2)  # 4 chars
    local seg5=$(openssl rand -hex 6)  # 12 chars
    echo "selfdb-${seg1}-${seg2}-${seg3}-${seg4}-${seg5}"
}

# Function to update a key in .env file
update_env_key() {
    local key_name="$1"
    local new_value="$2"
    
    if grep -q "^${key_name}=" "$ENV_FILE"; then
        # Key exists, update it
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS sed requires empty string for -i
            sed -i '' "s|^${key_name}=.*|${key_name}=${new_value}|" "$ENV_FILE"
        else
            # Linux sed
            sed -i "s|^${key_name}=.*|${key_name}=${new_value}|" "$ENV_FILE"
        fi
        echo -e "${GREEN}✓ Updated ${key_name}${NC}"
    else
        # Key doesn't exist, append it
        echo "${key_name}=${new_value}" >> "$ENV_FILE"
        echo -e "${GREEN}✓ Added ${key_name}${NC}"
    fi
}

# Show current keys (masked)
echo -e "${BLUE}Current keys in .env:${NC}"
current_secret=$(grep "^SECRET_KEY=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "not set")
current_api=$(grep "^API_KEY=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "not set")

if [[ "$current_secret" != "not set" && ${#current_secret} -gt 10 ]]; then
    echo -e "  SECRET_KEY: ${current_secret:0:10}...${current_secret: -4}"
else
    echo -e "  SECRET_KEY: ${current_secret}"
fi

if [[ "$current_api" != "not set" ]]; then
    echo -e "  API_KEY: ${current_api}"
fi
echo ""

# Ask user what to generate
echo -e "${YELLOW}What would you like to generate?${NC}"
echo "  1) SECRET_KEY only"
echo "  2) API_KEY only"
echo "  3) Both SECRET_KEY and API_KEY"
echo "  4) Cancel"
echo ""
read -p "Enter choice [1-4]: " choice

case $choice in
    1)
        echo ""
        new_secret=$(generate_secret_key)
        echo -e "${CYAN}New SECRET_KEY: ${new_secret}${NC}"
        echo ""
        read -p "Apply this SECRET_KEY to .env? [y/N]: " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            update_env_key "SECRET_KEY" "$new_secret"
        else
            echo -e "${YELLOW}Cancelled.${NC}"
        fi
        ;;
    2)
        echo ""
        new_api=$(generate_api_key)
        echo -e "${CYAN}New API_KEY: ${new_api}${NC}"
        echo ""
        read -p "Apply this API_KEY to .env? [y/N]: " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            update_env_key "API_KEY" "$new_api"
        else
            echo -e "${YELLOW}Cancelled.${NC}"
        fi
        ;;
    3)
        echo ""
        new_secret=$(generate_secret_key)
        new_api=$(generate_api_key)
        echo -e "${CYAN}New SECRET_KEY: ${new_secret}${NC}"
        echo -e "${CYAN}New API_KEY: ${new_api}${NC}"
        echo ""
        read -p "Apply BOTH keys to .env? [y/N]: " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            update_env_key "SECRET_KEY" "$new_secret"
            update_env_key "API_KEY" "$new_api"
        else
            echo -e "${YELLOW}Cancelled.${NC}"
        fi
        ;;
    4|*)
        echo -e "${YELLOW}Cancelled.${NC}"
        exit 0
        ;;
esac

echo ""
echo -e "${GREEN}Done!${NC}"
echo -e "${YELLOW}Note: Restart your services for changes to take effect.${NC}"
