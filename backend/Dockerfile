# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Prisma needs openssl to compile query engine binaries
RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Prisma needs openssl at runtime too
RUN apk add --no-cache openssl

WORKDIR /app

# Install all deps (ts-node is needed for seed.ts)
COPY package*.json ./
RUN npm ci

# Copy Prisma schema & generated client
COPY prisma ./prisma
RUN npx prisma generate

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Copy entrypoint
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["./entrypoint.sh"]
