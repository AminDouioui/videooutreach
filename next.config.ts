import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native Module und Remotion dürfen nicht gebündelt werden (nur der Worker nutzt Remotion)
  serverExternalPackages: ['better-sqlite3', 'nodemailer', 'imapflow', 'remotion', '@remotion/bundler', '@remotion/renderer', '@remotion/cli'],
  poweredByHeader: false,
  // Die Middleware puffert Request-Bodies nur bis zu diesem Limit (Standard 10 MB): Anhang-Uploads (bis 10 MB je Datei plus
  // Multipart-Overhead) würden sonst abgeschnitten. Die eigentliche Grenze prüft die Upload-Route.
  experimental: { middlewareClientMaxBodySize: '20mb' },
};

export default nextConfig;
