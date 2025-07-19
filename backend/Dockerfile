FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY src ./src

RUN --mount=type=cache,target=/root/.npm \
    npm ci \
 && npm run build


FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY --chown=node:node package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

ENV WORK_DIR=.workdir

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev \
 && npm cache clean --force \
 && mkdir -p .workdir/uploads \
 && mkdir -p .workdir/conversion \
 && chown -R node:node .workdir \
 && chmod 775 .workdir \
 && chmod 775 .workdir/uploads \
 && chmod 775 .workdir/conversion

USER node
CMD ["node", "dist/app.js"]
