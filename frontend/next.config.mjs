/** @type {import('next').NextConfig} */
const configuredBackendUrl =
  process.env.BACKEND_URL?.replace(/\/+$/, "") ||
  (process.env.NODE_ENV === "development" ? "http://localhost:4000" : "");

let backendUrl = configuredBackendUrl;
if (backendUrl) {
  let parsedBackendUrl;
  try {
    parsedBackendUrl = new URL(backendUrl);
  } catch {
    throw new Error("BACKEND_URL must be an absolute HTTP(S) URL.");
  }

  if (!["http:", "https:"].includes(parsedBackendUrl.protocol)) {
    throw new Error("BACKEND_URL must use HTTP or HTTPS.");
  }

  const isLocalBackend =
    parsedBackendUrl.hostname === "localhost" ||
    parsedBackendUrl.hostname === "127.0.0.1" ||
    parsedBackendUrl.hostname === "::1";
  if (process.env.NODE_ENV === "production" && parsedBackendUrl.protocol !== "https:") {
    if (isLocalBackend) {
      console.warn("Ignoring local BACKEND_URL in production; configure a public HTTPS backend URL to enable API routes.");
      backendUrl = "";
    } else {
      throw new Error("BACKEND_URL must use HTTPS in production.");
    }
  }
}

const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    if (!backendUrl) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
