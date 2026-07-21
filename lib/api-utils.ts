import { NextRequest, NextResponse } from "next/server";

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export async function readLimitedJsonBody<T>(req: NextRequest, maxBytes: number): Promise<T> {
  const contentLength = Number.parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiRequestError("Request body is too large.", 413);
  }

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > maxBytes) {
    throw new ApiRequestError("Request body is too large.", 413);
  }

  try {
    return JSON.parse(rawBody || "{}") as T;
  } catch {
    throw new ApiRequestError("Request body must be valid JSON.", 400);
  }
}

export function apiErrorResponse(
  error: unknown,
  options: { fallback: string; context?: string; status?: number },
) {
  if (error instanceof ApiRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (options.context) {
    console.error(`[${options.context}]`, error);
  }

  const message =
    process.env.NODE_ENV === "production"
      ? options.fallback
      : error instanceof Error
        ? error.message
        : options.fallback;

  return NextResponse.json({ error: message }, { status: options.status ?? 500 });
}

export function requireTrimmedString(value: unknown, fieldName: string, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new ApiRequestError(`${fieldName} is required.`, 400);
  }
  if (normalized.length > maxLength) {
    throw new ApiRequestError(`${fieldName} is too long.`, 400);
  }
  return normalized;
}
