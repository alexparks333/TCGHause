import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Google's avatar CDN — the only external image source we render
        // today (OAuth profile pictures). Keeping this as an explicit
        // allowlist means a tampered avatar_url pointing elsewhere just
        // fails to load instead of being fetched from an arbitrary host.
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        // Supabase Storage — real uploaded listing photos (CLAUDE.md §6.13).
        protocol: "https",
        hostname: "uyhrpwszltsbzmiyxdwr.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
