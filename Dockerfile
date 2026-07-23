# syntax = docker/dockerfile

FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/worker ./worker
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules

RUN npm install -g tsx

USER nextjs

ENV PORT=8080
ENV HOSTNAME="0.0.0.0"
ENV DB_PATH=/app/data/ml.db

EXPOSE 8080

RUN mkdir -p /app/data

CMD ["sh", "-c", "tsx /app/worker/index.ts & echo $! > /tmp/worker.pid & sleep 2 && exec node /app/server.js"]
