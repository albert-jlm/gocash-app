import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",         // Static export — required for Capacitor
  trailingSlash: true,
  images: {
    unoptimized: true,      // Required for static export (no image optimization server)
  },
};

export default nextConfig;
