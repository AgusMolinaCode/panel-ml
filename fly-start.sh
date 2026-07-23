#!/bin/sh
set -e

# Ensure data directory exists (volume mount point)
mkdir -p /app/data

# Start the worker in background
echo "Starting worker..."
node /app/worker.js &
WORKER_PID=$!

# Start Next.js server
echo "Starting Next.js..."
exec node /app/server.js
