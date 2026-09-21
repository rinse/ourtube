# Fargate conversion task image. Entrypoint is src/task/convert.ts, which
# runs LocalFfmpegConverter against one video (VIDEO_ID env var) and exits.
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY src ./src

RUN npm ci \
 && npm run build


FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY --chown=node:node package*.json ./
COPY --from=builder --chown=node:node /app/dist ./dist

ENV TMP_DIR=/tmp/videoplayer

RUN npm ci --omit=dev \
 && npm cache clean --force

USER node
CMD ["node", "dist/task/convert.js"]
