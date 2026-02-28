#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# provision-ec2.sh
# Run this ONCE from your local machine to:
#   1. Create a Security Group (ports 22, 80, 3001, 5432)
#   2. Launch an Amazon Linux 2023 EC2 instance (t3.small)
#   3. Wait for the instance to be SSH-ready
#   4. Upload the project code via SCP
#   5. Install Docker remotely (deploy/install-docker.sh)
#   6. Build & start the Docker stack remotely (deploy/deploy.sh)
#
# Usage:
#   chmod +x deploy/provision-ec2.sh
#   ./deploy/provision-ec2.sh
#
# Requirements (already done):
#   - ~/.aws/credentials has [rtb-deploy] profile
#   - ~/.ssh/rtb-key.pem exists (created by AWS CLI)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
AWS_PROFILE="rtb-deploy"
AWS_REGION="us-east-1"
KEY_NAME="rtb-key"
KEY_FILE="$HOME/.ssh/rtb-key.pem"
INSTANCE_TYPE="t3.small"
SG_NAME="rtb-sg"
REMOTE_USER="ec2-user"
REMOTE_APP_DIR="/home/ec2-user/realtime-task-board"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"      # repo root (one level up from deploy/)

export AWS_PROFILE AWS_REGION

# ─────────────────────────────────────────────────────────────────────────────
step() { echo ""; echo "══════════════════════════════════════════════════"; echo "  $*"; echo "══════════════════════════════════════════════════"; }

# ── 1. Security Group ─────────────────────────────────────────────────────────
step "1/6  Security Group"

SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$SG_NAME" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || true)

if [[ "$SG_ID" == "None" || -z "$SG_ID" ]]; then
    echo "Creating security group $SG_NAME..."
    SG_ID=$(aws ec2 create-security-group \
        --group-name "$SG_NAME" \
        --description "realtime-task-board: SSH, HTTP, API, Postgres" \
        --query 'GroupId' --output text)
    echo "Created: $SG_ID"

    # Add inbound rules
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22   --cidr 0.0.0.0/0  # SSH
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 80   --cidr 0.0.0.0/0  # Frontend
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 3001 --cidr 0.0.0.0/0  # Backend
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 5432 --cidr 0.0.0.0/0  # Postgres
    echo "Inbound rules added."
else
    echo "Reusing existing security group: $SG_ID"
fi

# ── 2. Latest Amazon Linux 2023 AMI ──────────────────────────────────────────
step "2/6  Finding latest Amazon Linux 2023 AMI"

AMI_ID=$(aws ec2 describe-images \
    --owners amazon \
    --filters \
        "Name=name,Values=al2023-ami-2023.*-kernel-6.*-x86_64" \
        "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text)

echo "AMI: $AMI_ID"

# ── 3. Launch instance ────────────────────────────────────────────────────────
step "3/6  Launching EC2 instance ($INSTANCE_TYPE)"

INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=realtime-task-board}]' \
    --query 'Instances[0].InstanceId' \
    --output text)

echo "Instance ID: $INSTANCE_ID"

# ── 4. Wait for instance to be running and status-checked ─────────────────────
step "4/6  Waiting for instance to be ready"

echo "Waiting for instance to enter 'running' state..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

PUBLIC_IP=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)

echo "Public IP: $PUBLIC_IP"
echo "Waiting for SSH port 22 to be open..."

for i in $(seq 1 30); do
    if nc -z -w5 "$PUBLIC_IP" 22 2>/dev/null; then
        echo "SSH is ready."
        break
    fi
    echo "  attempt $i/30 — waiting 10s..."
    sleep 10
done

# Extra buffer for sshd to fully start
sleep 5

SSH_OPTS="-i $KEY_FILE -o StrictHostKeyChecking=no -o ConnectTimeout=15"

# ── 5. Upload code via SCP ────────────────────────────────────────────────────
step "5/6  Uploading code via SCP"

echo "Creating remote app directory..."
# shellcheck disable=SC2029
ssh $SSH_OPTS "$REMOTE_USER@$PUBLIC_IP" "mkdir -p $REMOTE_APP_DIR"

echo "Uploading project files (excluding node_modules, dist, .git)..."
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'dist' \
    --exclude 'build' \
    --exclude '.env.prod' \
    -e "ssh $SSH_OPTS" \
    "$APP_DIR/" \
    "$REMOTE_USER@$PUBLIC_IP:$REMOTE_APP_DIR/"

echo "Code uploaded successfully."

# ── 6. Install Docker & start stack ──────────────────────────────────────────
step "6/6  Installing Docker and starting the stack"

echo "Running install-docker.sh on EC2..."
ssh $SSH_OPTS "$REMOTE_USER@$PUBLIC_IP" \
    "sudo bash $REMOTE_APP_DIR/deploy/install-docker.sh"

echo ""
echo "Running deploy.sh on EC2 (builds images & starts containers)..."
ssh $SSH_OPTS "$REMOTE_USER@$PUBLIC_IP" \
    "bash $REMOTE_APP_DIR/deploy/deploy.sh --ip $PUBLIC_IP"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║            DEPLOYMENT COMPLETE ✓                 ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Frontend  →  http://$PUBLIC_IP"
echo "║  Backend   →  http://$PUBLIC_IP:3001"
echo "║  Postgres  →  $PUBLIC_IP:5432"
echo "║"
echo "║  SSH:  ssh -i $KEY_FILE $REMOTE_USER@$PUBLIC_IP"
echo "║  Logs: ssh in, then:"
echo "║    docker compose -f ~/realtime-task-board/docker-compose.prod.yml logs -f"
echo "╚══════════════════════════════════════════════════╝"

# Save instance info locally for future redeploys
cat > "$SCRIPT_DIR/.ec2-state" <<STATE
INSTANCE_ID=$INSTANCE_ID
PUBLIC_IP=$PUBLIC_IP
SG_ID=$SG_ID
STATE
echo ""
echo "Instance info saved to deploy/.ec2-state"
