#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# destroy-ec2.sh
# Tears down everything created by provision-ec2.sh:
#   - Terminates the EC2 instance
#   - Deletes the Security Group (rtb-sg)
#   - Optionally deletes the SSH key pair (rtb-key) and local .pem file
#
# Usage:
#   ./deploy/destroy-ec2.sh            # reads deploy/.ec2-state automatically
#   ./deploy/destroy-ec2.sh --yes      # skip confirmation prompt
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

AWS_PROFILE="rtb-deploy"
AWS_REGION="us-east-1"
KEY_NAME="rtb-key"
KEY_FILE="$HOME/.ssh/rtb-key.pem"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.ec2-state"

export AWS_PROFILE AWS_REGION

# ── Load state ────────────────────────────────────────────────────────────────
if [[ ! -f "$STATE_FILE" ]]; then
    echo "ERROR: $STATE_FILE not found."
    echo "       Run provision-ec2.sh first, or set INSTANCE_ID and SG_ID manually."
    exit 1
fi

source "$STATE_FILE"
echo ""
echo "Loaded from $STATE_FILE:"
echo "  Instance : ${INSTANCE_ID:-<not set>}"
echo "  Public IP: ${PUBLIC_IP:-<not set>}"
echo "  Sec Group: ${SG_ID:-<not set>}"
echo ""

# ── Confirmation ──────────────────────────────────────────────────────────────
SKIP_CONFIRM=false
for arg in "$@"; do
    [[ "$arg" == "--yes" ]] && SKIP_CONFIRM=true
done

if [[ "$SKIP_CONFIRM" != true ]]; then
    read -rp "This will PERMANENTLY destroy the EC2 instance and all its data. Type 'yes' to confirm: " CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# ── 1. Terminate EC2 instance ─────────────────────────────────────────────────
if [[ -n "${INSTANCE_ID:-}" && "$INSTANCE_ID" != "None" ]]; then
    echo ""
    echo "=====> Terminating instance $INSTANCE_ID ..."
    aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" \
        --query 'TerminatingInstances[0].CurrentState.Name' --output text

    echo "=====> Waiting for instance to be fully terminated..."
    aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
    echo "       Instance terminated."
else
    echo "=====> No instance ID found — skipping termination."
fi

# ── 2. Delete Security Group ──────────────────────────────────────────────────
if [[ -n "${SG_ID:-}" && "$SG_ID" != "None" ]]; then
    echo ""
    echo "=====> Deleting security group $SG_ID ..."
    # SG deletion can fail if dependencies still exist — retry a few times
    for attempt in 1 2 3; do
        if aws ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null; then
            echo "       Security group deleted."
            break
        else
            echo "       Attempt $attempt failed (may still have dependencies). Waiting 10s..."
            sleep 10
        fi
    done
else
    echo "=====> No security group ID found — skipping."
fi

# ── 3. Optionally delete key pair ─────────────────────────────────────────────
echo ""
read -rp "Delete SSH key pair '$KEY_NAME' from AWS and local .pem file? [y/N]: " DEL_KEY
if [[ "$DEL_KEY" =~ ^[Yy]$ ]]; then
    echo "=====> Deleting key pair $KEY_NAME from AWS..."
    aws ec2 delete-key-pair --key-name "$KEY_NAME" && echo "       Key pair deleted from AWS."

    if [[ -f "$KEY_FILE" ]]; then
        rm -f "$KEY_FILE"
        echo "       Removed local key file: $KEY_FILE"
    fi
else
    echo "=====> Keeping key pair (re-usable for future deployments)."
fi

# ── 4. Clean up state file ────────────────────────────────────────────────────
rm -f "$STATE_FILE"
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║           INFRASTRUCTURE DESTROYED ✓             ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Instance  $INSTANCE_ID  → terminated"
echo "║  Sec Group $SG_ID        → deleted"
echo "║  State file deploy/.ec2-state → removed"
echo "╚══════════════════════════════════════════════════╝"
