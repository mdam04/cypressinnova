import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    clientRouterFilter: false,
    clientRouterFilterRedirects: false,
    serverActions: true,
    serverActionsBodySizeLimit: '2mb',
    serverComponentsExternalPackages: [],
    useSearchParamsInServerComponent: true
  }
};

export default nextConfig;