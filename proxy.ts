import { NextResponse, type NextRequest } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ACCESS_COOKIE = "dashboard-access-token";
const REFRESH_COOKIE = "dashboard-refresh-token";
const REFRESH_SKEW_SECONDS = 5 * 60;
const AUTH_REFRESH_TIMEOUT_MS = 4000;
const REFRESH_SKIP_PATHS = [
  "/api/webhook",
  "/api/whatsapp/flows",
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
];

type SupabaseRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
};

function isCrossSiteBrowserRequest(request: NextRequest) {
  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (secFetchSite === "cross-site") {
    return true;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin !== request.nextUrl.origin;
  } catch {
    return true;
  }
}

function decodeJwtPayload(token: string): { exp?: number } | null {
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const paddedPayload = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf8")) as { exp?: number };
  } catch {
    return null;
  }
}

function shouldRefreshAccessToken(accessToken: string | undefined, refreshToken: string | undefined) {
  if (!refreshToken) return false;
  if (!accessToken) return true;

  const payload = decodeJwtPayload(accessToken);
  const expiresAt = typeof payload?.exp === "number" ? payload.exp : 0;
  return expiresAt <= Math.floor(Date.now() / 1000) + REFRESH_SKEW_SECONDS;
}

function withCookieHeader(request: NextRequest, accessToken: string, refreshToken: string) {
  const cookies = new Map(request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]));
  cookies.set(ACCESS_COOKIE, accessToken);
  cookies.set(REFRESH_COOKIE, refreshToken);
  return Array.from(cookies, ([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
}

function setAuthCookies(response: NextResponse, payload: Required<SupabaseRefreshResponse>) {
  const expires = new Date(payload.expires_at * 1000);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };

  response.cookies.set(ACCESS_COOKIE, payload.access_token, {
    ...cookieOptions,
    expires,
  });
  response.cookies.set(REFRESH_COOKIE, payload.refresh_token, {
    ...cookieOptions,
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}

function clearAuthCookies(response: NextResponse) {
  response.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
}

async function refreshDashboardSession(refreshToken: string): Promise<Required<SupabaseRefreshResponse> | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REFRESH_TIMEOUT_MS);
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as SupabaseRefreshResponse;
    if (!payload.access_token || !payload.refresh_token || !payload.expires_at) {
      return null;
    }

    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: payload.expires_at,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function shouldSkipRefresh(pathname: string) {
  return REFRESH_SKIP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  if (MUTATING_METHODS.has(request.method) && isCrossSiteBrowserRequest(request)) {
    return NextResponse.json({ error: "Cross-site API requests are not allowed." }, { status: 403 });
  }

  if (!shouldSkipRefresh(request.nextUrl.pathname)) {
    const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

    if (shouldRefreshAccessToken(accessToken, refreshToken)) {
      const refreshed = await refreshDashboardSession(refreshToken!);
      if (refreshed) {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("cookie", withCookieHeader(request, refreshed.access_token, refreshed.refresh_token));
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        setAuthCookies(response, refreshed);
        return response;
      }

      const response = NextResponse.next();
      clearAuthCookies(response);
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/dashboard/:path*"],
};
