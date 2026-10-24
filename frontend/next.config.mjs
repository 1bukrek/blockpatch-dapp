/** @type {import('next').NextConfig} */
const configuredBackendUrl =
  process.env.BACKEND_URL?.replace(/\/+$/, "") ||
  (process.env.NODE_ENV === "development" ? "http://localhost:4000" : "");

if (!configuredBackendUrl) {
  throw new Error("Set BACKEND_URL to the deployed backend URL.");
}

let parsedBackendUrl;
try {
  parsedBackendUrl = new URL(configuredBackendUrl);
} catch {
  throw new Error("BACKEND_URL must be an absolute HTTP(S) URL.");
}

if (
  !["http:", "https:"].includes(parsedBackendUrl.protocol) ||
  (process.env.NODE_ENV === "production" && parsedBackendUrl.protocol !== "https:")
) {
  throw new Error("BACKEND_URL must use HTTPS in production and HTTP(S) otherwise.");
}

const backendUrl = configuredBackendUrl;

const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
