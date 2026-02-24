#!/bin/bash
# Simisola123#123#

# Cloudflare IPv4 Ranges
IPV4_RANGES=(
"173.245.48.0/20"
"103.21.244.0/22"
"103.22.200.0/22"
"103.31.4.0/22"
"141.101.64.0/18"
"108.162.192.0/18"
"190.93.240.0/20"
"188.114.96.0/20"
"197.234.240.0/22"
"198.41.128.0/17"
"162.158.0.0/15"
"104.16.0.0/13"
"104.24.0.0/14"
"172.64.0.0/13"
"131.0.72.0/22"
)

# Cloudflare IPv6 Ranges
IPV6_RANGES=(
"2400:cb00::/32"
"2606:4700::/32"
"2803:f800::/32"
"2405:b500::/32"
"2405:8100::/32"
"2a06:98c0::/29"
"2c0f:f248::/32"
)

echo "Simisola123#123#" | sudo -S ufw status | grep -q "active" || { echo "UFW is not active. Enabling now..."; echo "y" | echo "Simisola123#123#" | sudo -S ufw enable; }

# Remove existing 80/443 rules to avoid duplicates or conflicts
echo "Simisola123#123#" | sudo -S ufw delete allow 80/tcp
echo "Simisola123#123#" | sudo -S ufw delete allow 443/tcp

# Allow IPv4
for range in "${IPV4_RANGES[@]}"; do
    echo "Simisola123#123#" | sudo -S ufw allow from "$range" to any port 80 proto tcp
    echo "Simisola123#123#" | sudo -S ufw allow from "$range" to any port 443 proto tcp
done

# Allow IPv6
for range in "${IPV6_RANGES[@]}"; do
    echo "Simisola123#123#" | sudo -S ufw allow from "$range" to any port 80 proto tcp
    echo "Simisola123#123#" | sudo -S ufw allow from "$range" to any port 443 proto tcp
done

echo "Simisola123#123#" | sudo -S ufw status verbose
