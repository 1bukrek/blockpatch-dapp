const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "";

function isLocalUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function apiUrl(path: string) {
  if (!configuredApiUrl) {
    throw new Error(
      "Backend is not configured for this deployment. Set NEXT_PUBLIC_API_URL to its public HTTPS URL.",
    );
  }

  let parsedApiUrl: URL;
  try {
    parsedApiUrl = new URL(configuredApiUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(parsedApiUrl.protocol)) {
    throw new Error("NEXT_PUBLIC_API_URL must use HTTP or HTTPS.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    (parsedApiUrl.protocol !== "https:" || isLocalUrl(configuredApiUrl))
  ) {
    throw new Error(
      "Backend is not configured for this deployment. Set NEXT_PUBLIC_API_URL to its public HTTPS URL.",
    );
  }

  return `${configuredApiUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
