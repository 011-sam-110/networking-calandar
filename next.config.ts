import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: this repo lives inside another git repo that has its
  // own lockfile, so Turbopack would otherwise infer the wrong root.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
