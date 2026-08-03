"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { RestaurantProfile } from "@/lib/restaurant-profile-types";

export function LoginForm({ profile }: { profile: RestaurantProfile }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Login failed.");
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div suppressHydrationWarning className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/10">
          {profile.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.logo_url} alt={`${profile.app_name} logo`} className="h-full w-full object-cover" />
          ) : (
            <span className="text-base font-black text-brand">{profile.app_name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">{profile.app_name}</p>
          <p className="mt-1 text-xs text-slate-400">{profile.dashboard_title}</p>
        </div>
      </div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Dashboard Login</h1>
      <p className="mt-2 text-sm text-slate-300">
        Sign in with your staff account to access the restaurant dashboard.
      </p>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-200">Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            placeholder="staff@restaurant.com"
            required
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-200">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            placeholder="Enter your password"
            required
          />
        </label>

        {error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
