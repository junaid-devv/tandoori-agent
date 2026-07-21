import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow ngrok domains in development
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app"],
};

export default nextConfig;
