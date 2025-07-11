FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY src ./src

RUN --mount=type=cache,target=/root/.npm \
    npm ci \
 && npm run build


FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg  \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nodejs -u 1001

COPY package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev && \
    npm cache clean --force \
 && mkdir -p uploads videos \
 && chown -R nodejs:nodejs uploads videos

USER nodejs
EXPOSE 4000
CMD ["node", "dist/app.js"]
