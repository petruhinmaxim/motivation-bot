FROM node:20-alpine AS builder

WORKDIR /app

# Copy dashboard
COPY dashboard ./dashboard
WORKDIR /app/dashboard

# Install deps
RUN npm install

# Build Next.js (needs DATABASE_URL for server-side, use dummy for build)
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone output
COPY --from=builder /app/dashboard/.next/standalone ./
COPY --from=builder /app/dashboard/.next/static ./.next/static
COPY --from=builder /app/dashboard/public ./public

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
