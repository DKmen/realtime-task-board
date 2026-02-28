#!/bin/sh
set -e

echo "Pushing Prisma schema to database..."
npx prisma db push --accept-data-loss

echo "Seeding database..."
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts

echo "Starting server..."
exec node dist/server.js
