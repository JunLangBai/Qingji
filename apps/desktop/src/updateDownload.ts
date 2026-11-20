export function isAllowedUpdateDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (
      url.protocol === "https:" &&
      url.pathname.endsWith("/v1/update/download")
    ) {
      return true;
    }
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]") &&
      url.pathname.endsWith("/v1/update/download")
    );
  } catch {
    return false;
  }
}
