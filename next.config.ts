import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native Module dürfen nicht gebündelt werden (Remotion-Pakete folgen in Phase 2)
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
};

export default nextConfig;
