# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OurTube — a personal (single-user) YouTube-like video service. Upload → HLS
conversion → streaming. The stack is AWS-serverless but runs fully locally for
fast development. See `docs/architecture.md` for the full picture.

## Architecture (current)

- **API**: single Lambda behind a Function URL, wrapped by `@codegenie/serverless-express`.
  The Express app is a factory (`backend/src/app.ts` `createApp(deps)`) shared by the
  local server (`backend/src/server.ts`) and the Lambda adapter (`backend/src/lambda/api.ts`).
- **Metadata**: DynamoDB single table via `MetadataStore` / `DynamoMetadataStore`
  (`backend/src/metadata/`). Schema: `docs/dynamodb-schema.md`. Local: DynamoDB Local.
- **Storage**: S3 via `VideoStorage` / `S3VideoStorage` (`backend/src/storage/`),
  pure I/O + presign. Local: MinIO (S3 SDK + custom endpoint).
- **Conversion**: `Converter` abstraction. Prod = `MediaConvertConverter` (submits a
  job) + `backend/src/lambda/conversion.ts` (EventBridge completion → `finalize`).
  Local = `LocalFfmpegConverter` (ffmpeg in-process, background).
- **AI**: `GenAI`, selected by `GENAI_PROVIDER`: `BedrockGenAI` (prod) / `OpenAIGenAI` /
  `MantleGenAI` (AWS Bedrock Mantle) / `LMStudioGenAI` (local default).
- **Auth**: the platform-wide `session` cookie (ES256 JWT, `Domain=.app.esnir.net`,
  minted by auth.app.esnir.net) is verified against its JWKS (`backend/src/auth/`).
  Every `/api/*` route is guarded; there is no login endpoint here. `AUTH_BYPASS=1` locally.
- **Frontend**: Next.js static export (`output: 'export'`), client-rendered, calls
  same-origin `/api/*`. Detail page is `/videos?id=...` (no dynamic route, for static export).
- **Delivery**: CloudFront fronts the SPA (S3+OAC) and proxies `/api/*` to the Lambda.
  HLS playback is single-path: the API serves `index.m3u8` verbatim (relative paths);
  each segment request (`GET /api/videos/:id/:segment`) is 302-redirected to a
  per-request presigned S3/MinIO URL.
- **IaC**: AWS CDK (`infra/`), two stacks: `OurtubeCertStack` (us-east-1, ACM cert) and
  `VideoplayerStack` (ap-northeast-1), wired by cross-region references. **CI/CD**:
  GitHub Actions (`.github/workflows/`), deploy runs on push to `main` via OIDC.
  App-only changes use the `production` Environment (no approval); `infra/**` and
  workflow changes, and any `workflow_dispatch`, use `production-infra` (required reviewer).

## Dependency wiring

`backend/src/config.ts` builds `AppConfig` from env; `backend/src/dependencies.ts`
constructs `{ metadata, playlist, storage, converter, genAI }`. Handlers take these deps —
do not reach for globals.

## Commands

```bash
# Local dev (MinIO + DynamoDB Local + backend:4000 + frontend:3000)
bash scripts/dev.sh

# Backend
cd backend && npm run dev        # nodemon (src/server.ts)
cd backend && npm run typecheck  # tsc --noEmit
cd backend && npm test           # vitest

# Frontend
cd frontend && npm run dev
cd frontend && NEXT_EXPORT=true npm run build   # static export to out/

# Infra
cd infra && npm run synth
cd infra && npm run deploy        # cdk deploy --all (normally via GitHub Actions)
```

## Conventions / gotchas

- **Upload** is browser SHA256 → `POST /api/uploads` (presigned PUT, dedup) → PUT
  straight to S3 → `POST /api/uploads/:id/complete` (starts conversion). Bytes never
  pass through the API, and conversion is triggered by that call, not by an S3 event.
- **Status** is only `converting | ready | failed` (no `pending`). `has_thumbnail`
  is a native boolean.
- **Thumbnail** filename is `thumbnail.jpg` (both converters).
- Keep storage/metadata interfaces thin so unit tests use in-memory fakes
  (`InMemoryMetadataStore`, hand-rolled storage fakes) without AWS.
- Tests live next to code as `*.test.ts` (vitest), excluded from the tsc build.
- The sandbox sometimes denies `rm`; use `git rm`. Branch with `git switch -c`.

## Database schema

DynamoDB single table `videoplayer` — see `docs/dynamodb-schema.md`.

## API endpoints

See README.md (table). Everything under `/api/*` requires the platform session cookie.
