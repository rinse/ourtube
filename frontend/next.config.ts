import type { NextConfig } from "next";

// Static export for production (served from S3/CloudFront). During `next dev`
// we keep a server so the /api rewrite proxies to the local backend; the export
// build (NEXT_EXPORT=true) emits a static SPA where /api is same-origin (CloudFront
// routes /api/* to the API Lambda).
const isExport = process.env.NEXT_EXPORT === 'true';
const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';

const nextConfig: NextConfig = isExport
  ? {
      output: 'export',
      images: { unoptimized: true },
    }
  : {
      images: { unoptimized: true },
      async rewrites() {
        return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
      },
    };

export default nextConfig;
