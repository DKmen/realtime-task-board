#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# install-docker.sh
# Installs Docker + Docker Compose v2 on a fresh EC2 instance.
# Called automatically by provision-ec2.sh via SSH — no manual steps needed.
#
# Supports: Amazon Linux 2023  |  Ubuntu 22.04 / 24.04
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "=====> Detecting OS..."
. /etc/os-release
echo "       Distro: $ID $VERSION_ID"

install_amazon() {
    echo "=====> Installing Docker (Amazon Linux 2023)..."
    dnf update -y
    dnf install -y docker git rsync
    systemctl enable --now docker
    usermod -aG docker ec2-user

    echo "=====> Installing latest Docker Buildx plugin..."
    mkdir -p /usr/local/lib/docker/cli-plugins
    BUILDX_VER=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest \
        | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
    curl -SL "https://github.com/docker/buildx/releases/download/${BUILDX_VER}/buildx-${BUILDX_VER}.linux-${ARCH}" \
        -o /usr/local/lib/docker/cli-plugins/docker-buildx
    chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

    echo "=====> Installing Docker Compose v2 plugin..."
    COMPOSE_VER=$(curl -s https://api.github.com/repos/docker/compose/releases/latest \
        | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-linux-$(uname -m)" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
}

install_ubuntu() {
    echo "=====> Installing Docker (Ubuntu)..."
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg git rsync
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    usermod -aG docker ubuntu
}

case "$ID" in
    amzn)   install_amazon ;;
    ubuntu) install_ubuntu ;;
    *)      echo "Unsupported OS: $ID"; exit 1 ;;
esac

echo "=====> Docker   : $(docker --version)"
echo "=====> Compose  : $(docker compose version)"
echo "=====> Done — Docker is ready."
