import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's dev server (Turbopack) blocks cross-origin requests for its own
  // dev assets by default — loading the site from a LAN IP instead of
  // localhost silently breaks client-side hydration (buttons render but
  // don't respond to clicks) unless that origin is explicitly allowed here.
  // Needed for testing the Sell wizard's phone-upload QR feature, where
  // both the desktop browser and the phone have to reach the dev server via
  // its LAN IP. Update this if the dev machine's LAN IP changes.
  allowedDevOrigins: ["192.168.4.29"],
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
