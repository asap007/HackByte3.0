/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  assetPrefix: './',
  output: 'export', // Changed from 'standalone' to 'export' for static generation
  images: {
    unoptimized: true,
  },
  // Remove experimental options as they're not needed for static export
  // Remove rewrites as they won't work in static export
}

export default nextConfig