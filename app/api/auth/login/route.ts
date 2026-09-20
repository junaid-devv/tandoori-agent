import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { setDashboardSessionCookies, signInWithPassword } from "@/lib/auth";
import { buildRateLimitHeaders, checkRateLimit, getClientIp } from "@/lib/rate-limit";

type LoginBody = {
  username?: string;
  email?: string;
  password?: string;
};

const LOGIN_BODY_LIMIT_BYTES = 4 * 1024;

export async function POST(req: NextRequest) {
  try {
    const body = await readLimitedJsonBody<LoginBody>(req, LOGIN_BODY_LIMIT_BYTES);
    const identifier = (body.username || body.email || "").trim();
    const password = body.password?.trim();

    if (!identifier || !password) {
      return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
    }

    // Support username alias from env var, or require email login
    const adminEmail = process.env.ADMIN_EMAIL || "admin@orderiq.local";
    const emailToAuth =
      !identifier.includes("@")
        ? adminEmail
        : identifier;

    const rateLimit = await checkRateLimit({
      scope: "dashboard_login",
      identifier: `${getClientIp(req)}:${emailToAuth}`,
      limit: Number(process.env.LOGIN_RATE_LIMIT_ATTEMPTS) || 8,
      windowSeconds: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS) || 15 * 60,
      blockSeconds: Number(process.env.LOGIN_RATE_LIMIT_BLOCK_SECONDS) || 15 * 60,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: buildRateLimitHeaders(rateLimit) },
      );
    }

    const session = await signInWithPassword(emailToAuth, password);
    await setDashboardSessionCookies({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Login failed.", context: "auth login", status: 401 });
  }
}
