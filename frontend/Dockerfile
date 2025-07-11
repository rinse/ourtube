FROM node:22-alpine AS builder

WORKDIR /app

COPY . .

ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL

RUN npm ci \
 && npm run build


FROM node:22-alpine

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

COPY package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/.next ./.next
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
COPY --from=builder --chown=nodejs:nodejs /app/next.config.ts ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev \
 && npm cache clean --force \
 && mkdir -p .next/cache

USER nodejs
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
