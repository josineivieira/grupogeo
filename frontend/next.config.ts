import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  async rewrites() {
    const backend = process.env.API_INTERNAL_URL?.replace(/\/$/, '');
    return backend ? [{ source: '/api/:path*', destination: `${backend}/api/:path*` }] : [];
  },
};
export default config;
