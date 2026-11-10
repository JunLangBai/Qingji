export interface SafeErrorDetails {
  name: string;
  code?: string;
}

export function safeErrorDetails(error: unknown): SafeErrorDetails {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  return {
    name: error.name || "Error",
    ...(code ? { code } : {}),
  };
}
