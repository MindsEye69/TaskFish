import type { NextConfig } from "next";

const isStaticExport = process.env.TASKFISH_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  output: isStaticExport ? "export" : undefined,
  assetPrefix: isStaticExport ? "./" : undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
