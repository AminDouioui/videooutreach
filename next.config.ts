import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native Module und Remotion dürfen nicht gebündelt werden (nur der Worker nutzt Remotion)
  serverExternalPackages: ['better-sqlite3', 'remotion', '@remotion/bundler', '@remotion/renderer', '@remotion/cli'],
  poweredByHeader: false,
};

export default nextConfig;
