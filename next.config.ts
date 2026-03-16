import os from "node:os";

import type { NextConfig } from "next";

function getAllowedDevOrigins() {
  const configuredOrigins = process.env.NEXT_DEV_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins && configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  const privateIpv4Origins = Object.values(os.networkInterfaces())
    .flat()
    .filter((network) => network?.family === "IPv4" && !network.internal)
    .map((network) => network?.address)
    .filter((address): address is string => Boolean(address));

  return Array.from(new Set(["localhost", "127.0.0.1", ...privateIpv4Origins]));
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
};

export default nextConfig;
