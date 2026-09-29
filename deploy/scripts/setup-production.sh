#!/usr/bin/env bash
set -euo pipefail

# Dogfood Host Initialization Script
# Prepares a fresh Ubuntu/Debian server for Docker Compose production deployment

echo "==> Checking system prerequisites..."

# 1. Configure Swap if needed (essential for Next.js builds on machines with <= 2GB RAM)
TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
if [ "${TOTAL_MEM}" -lt 2500 ] && [ ! -f /swapfile ]; then
    echo "==> Configuring 2.5GB swapfile for compilation headroom..."
    sudo fallocate -l 2.5G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    if ! grep -q '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    fi
    echo "==> Swap configured successfully."
fi

# 2. Install Docker and Docker Compose
echo "==> Updating package repository and installing dependencies..."
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git docker.io docker-compose-v2

# 3. Enable and start Docker service
echo "==> Starting Docker service..."
sudo systemctl enable --now docker

# 4. Add current user to docker group if non-root
if [ "${USER}" != "root" ]; then
    sudo usermod -aG docker "${USER}" || true
    echo "==> Added ${USER} to docker group."
fi

echo "==> Host setup complete!"
echo "==> You can now build and launch the application with:"
echo "    docker compose up --build -d"
