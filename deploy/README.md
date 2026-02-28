# Deploying to AWS EC2 (SCP upload)

All three services (PostgreSQL, backend, frontend) run as Docker containers
inside a single EC2 instance and are exposed on public ports.

```
Internet
  │
  ├─ :80   → frontend  (nginx serving Vite SPA)
  ├─ :3001 → backend   (Node + Socket.IO API)
  └─ :5432 → postgres
```

## Scripts overview

| Script | Where it runs | Purpose |
|---|---|---|
| `deploy/provision-ec2.sh` | **Local machine** | Creates SG, launches EC2, uploads code via SCP, installs Docker, starts stack |
| `deploy/install-docker.sh` | EC2 (via SSH) | Installs Docker + Compose v2 — called by provision-ec2.sh |
| `deploy/deploy.sh` | EC2 (via SSH) | Writes `.env.prod`, runs `docker compose up --build` |

---

## Prerequisites (one-time, already done)

- AWS CLI configured: `~/.aws/credentials` has `[rtb-deploy]` profile
- SSH key saved at `~/.ssh/rtb-key.pem` (created via `aws ec2 create-key-pair`)

---

## 1 — First-time deploy (one command)

```bash
chmod +x deploy/provision-ec2.sh
./deploy/provision-ec2.sh
```

That single command will:
1. Create Security Group `rtb-sg` (ports 22, 80, 3001, 5432)
2. Find the latest Amazon Linux 2023 AMI
3. Launch a `t3.small` EC2 instance with a 20 GB gp3 volume
4. Wait until SSH is available
5. Upload the entire project via `rsync` over SSH (excludes `node_modules`, `.git`, `dist`)
6. Run `install-docker.sh` remotely to install Docker + Compose
7. Run `deploy.sh` remotely to build images and start containers

At the end you'll see:
```
╔══════════════════════════════════════════════════╗
║            DEPLOYMENT COMPLETE ✓                 ║
╠══════════════════════════════════════════════════╣
║  Frontend  →  http://<EC2_IP>
║  Backend   →  http://<EC2_IP>:3001
║  Postgres  →  <EC2_IP>:5432
╚══════════════════════════════════════════════════╝
```

Instance details are saved to `deploy/.ec2-state` for re-use.

---

## 2 — Re-deploy (code update)

After making code changes just SCP the updated files and re-run deploy.sh:

```bash
# Read saved instance IP
source deploy/.ec2-state
KEY="$HOME/.ssh/rtb-key.pem"
SSH_OPTS="-i $KEY -o StrictHostKeyChecking=no"

# Upload updated code
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'dist' --exclude '.env.prod' \
    -e "ssh $SSH_OPTS" \
    ./ ec2-user@$PUBLIC_IP:/home/ec2-user/realtime-task-board/

# Rebuild & restart
ssh $SSH_OPTS ec2-user@$PUBLIC_IP \
    "bash /home/ec2-user/realtime-task-board/deploy/deploy.sh --ip $PUBLIC_IP"
```

---

## 3 — Verify

```bash
source deploy/.ec2-state
curl -I http://$PUBLIC_IP            # frontend → 200 OK
curl http://$PUBLIC_IP:3001/health   # backend health check
```

SSH into the instance:
```bash
ssh -i ~/.ssh/rtb-key.pem ec2-user@$PUBLIC_IP

# Inside EC2:
docker compose -f ~/realtime-task-board/docker-compose.prod.yml ps
docker compose -f ~/realtime-task-board/docker-compose.prod.yml logs -f
```

---

## 4 — Useful commands (on EC2)

```bash
cd ~/realtime-task-board

# Stop the stack
docker compose -f docker-compose.prod.yml down

# Stop + remove volumes (⚠ deletes all DB data)
docker compose -f docker-compose.prod.yml down -v

# Restart a single service
docker compose -f docker-compose.prod.yml restart backend

# Connect to Postgres
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U postgres -d realtime_task_board
```

---

## 5 — Environment variables reference

| Variable | Default | Description |
|---|---|---|
| `EC2_PUBLIC_IP` | — | **Required.** Public IP or DNS of the EC2 instance |
| `POSTGRES_USER` | `postgres` | Postgres username |
| `POSTGRES_PASSWORD` | `postgres` | Postgres password – change in production! |
| `POSTGRES_DB` | `realtime_task_board` | Database name |
| `JWT_SECRET` | `changeme` | JWT signing secret – change in production! |
