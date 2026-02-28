#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh
# Run this on the EC2 instance (after Docker is installed) to deploy or
# update the realtime-task-board stack.
#
# Usage:
#   chmod +x deploy/deploy.sh
#   ./deploy/deploy.sh [--ip <EC2_PUBLIC_IP>]
#
# If --ip is omitted the script auto-detects the public IP from instance
# metadata (works only on EC2).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"      # one level up from deploy/
ENV_FILE="$APP_DIR/.env.prod"

# ── Parse optional --ip argument ─────────────────────────────────────────────
EC2_PUBLIC_IP=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --ip) EC2_PUBLIC_IP="$2"; shift 2 ;;
        *)    echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── Auto-detect IP if not provided ───────────────────────────────────────────
if [[ -z "$EC2_PUBLIC_IP" ]]; then
    echo "=====> Auto-detecting EC2 public IP..."
    TOKEN=$(curl -s --max-time 5 -X PUT "http://169.254.169.254/latest/api/token" \
        -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" || true)
    if [[ -n "$TOKEN" ]]; then
        EC2_PUBLIC_IP=$(curl -s --max-time 5 \
            -H "X-aws-ec2-metadata-token: $TOKEN" \
            http://169.254.169.254/latest/meta-data/public-ipv4 || true)
    fi
fi

# ── Fallback: ask the user ────────────────────────────────────────────────────
if [[ -z "$EC2_PUBLIC_IP" ]]; then
    read -rp "Enter EC2 public IP / DNS (e.g. 54.12.34.56): " EC2_PUBLIC_IP
fi

echo "=====> Using public endpoint: $EC2_PUBLIC_IP"

# ── Write/refresh .env.prod ───────────────────────────────────────────────────
# Preserve existing secrets (POSTGRES_PASSWORD, JWT_SECRET) if the file exists
if [[ -f "$ENV_FILE" ]]; then
    echo "=====> Updating EC2_PUBLIC_IP in existing $ENV_FILE"
    # Replace or append EC2_PUBLIC_IP line
    if grep -q "^EC2_PUBLIC_IP=" "$ENV_FILE"; then
        sed -i "s|^EC2_PUBLIC_IP=.*|EC2_PUBLIC_IP=${EC2_PUBLIC_IP}|" "$ENV_FILE"
    else
        echo "EC2_PUBLIC_IP=${EC2_PUBLIC_IP}" >> "$ENV_FILE"
    fi
else
    echo "=====> Creating $ENV_FILE from example..."
    cp "$APP_DIR/.env.prod.example" "$ENV_FILE"
    sed -i "s|<your-ec2-public-ip-or-dns>|${EC2_PUBLIC_IP}|" "$ENV_FILE"
    echo ""
    echo "  ⚠  Review $ENV_FILE and change POSTGRES_PASSWORD and JWT_SECRET"
    echo "     before running in production, then re-run this script."
    echo ""
fi

# ── Build & start ─────────────────────────────────────────────────────────────
echo "=====> Building and starting containers..."
cd "$APP_DIR"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build

echo ""
echo "=====> Stack is up!"
echo ""
echo "       Frontend  → http://${EC2_PUBLIC_IP}"
echo "       Backend   → http://${EC2_PUBLIC_IP}:3001"
echo "       Postgres  → ${EC2_PUBLIC_IP}:5432 (restrict via Security Group)"
echo ""
echo "       Logs:  docker compose -f docker-compose.prod.yml logs -f"
echo "       Stop:  docker compose -f docker-compose.prod.yml down"
