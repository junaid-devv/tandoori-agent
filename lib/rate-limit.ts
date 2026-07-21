import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "./supabase-admin";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  blockedUntil: string | null;
};

export type RateLimitInput = {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
  blockSeconds?: number;
};

const FALLBACK_IDENTIFIER = "unknown";

export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const vercelForwardedFor = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || realIp || vercelForwardedFor || FALLBACK_IDENTIFIER;
}

export function buildRateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "Retry-After": getRetryAfterSeconds(result).toString(),
    "X-RateLimit-Remaining": Math.max(result.remaining, 0).toString(),
    "X-RateLimit-Reset": result.resetAt,
  };
}

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const limit = Math.max(1, Math.floor(input.limit));
  const windowSeconds = Math.max(1, Math.floor(input.windowSeconds));
  const blockSeconds = Math.max(0, Math.floor(input.blockSeconds ?? 0));
  const scope = input.scope.trim().slice(0, 80);
  const identifierHash = hashRateLimitIdentifier(input.identifier);

  const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
    p_scope: scope,
    p_identifier_hash: identifierHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
    p_block_seconds: blockSeconds,
  });

  if (error) {
    console.error("[rate-limit] Failed to check rate limit:", error);
    return {
      allowed: true,
      remaining: 0,
      resetAt: new Date(Date.now() + windowSeconds * 1000).toISOString(),
      blockedUntil: null,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: row?.allowed !== false,
    remaining: Number(row?.remaining ?? 0),
    resetAt: typeof row?.reset_at === "string" ? row.reset_at : new Date(Date.now() + windowSeconds * 1000).toISOString(),
    blockedUntil: typeof row?.blocked_until === "string" ? row.blocked_until : null,
  };
}

function hashRateLimitIdentifier(identifier: string): string {
  const secret = process.env.RATE_LIMIT_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "local-rate-limit-secret";
  return createHmac("sha256", secret).update(identifier.trim().toLowerCase() || FALLBACK_IDENTIFIER).digest("hex");
}

function getRetryAfterSeconds(result: RateLimitResult): number {
  const target = result.blockedUntil ?? result.resetAt;
  const targetMs = new Date(target).getTime();
  if (!Number.isFinite(targetMs)) return 60;
  return Math.max(1, Math.ceil((targetMs - Date.now()) / 1000));
}
