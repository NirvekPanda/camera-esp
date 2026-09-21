import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export", // static files in ./out, served by nginx
  trailingSlash: true, // emits /page/index.html so nginx needs no rewrites
};

export default nextConfig;
