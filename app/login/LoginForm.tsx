"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2, UtensilsCrossed } from "lucide-react";
import type { RestaurantProfile } from "@/lib/restaurant-profile-types";

export function LoginForm({ profile }: { profile: Pick<RestaurantProfile, "app_name" | "logo_url"> }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not sign in. Check your login details and try again.");
      router.replace("/dashboard"); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not sign in."); } finally { setSaving(false); }
  }

  return <div className="w-full max-w-[380px]">
    <div className="mb-10 flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white"><UtensilsCrossed size={18} /></span><span className="text-xl font-bold tracking-tight text-slate-800">order<span className="text-brand">iq.</span></span></div>
    <p className="ui-eyebrow mb-3">Your restaurant workspace</p>
    <h1 className="text-[30px] font-semibold tracking-[-1px] text-slate-900">Welcome back.</h1>
    <p className="mt-3 text-sm leading-relaxed text-slate-500">Sign in to manage your orders, customers and team.</p>
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">{error}</p>}
      <label className="block"><span className="ui-label">Username or email</span><input required type="text" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} className="ui-input h-11" placeholder="Enter your username or email" disabled={saving} /></label>
      <label className="block"><span className="ui-label">Password</span><div className="relative"><input required type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="ui-input ui-input-action h-11" placeholder="Enter your password" disabled={saving} /><button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)} className="absolute top-1 right-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50">{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
      <button type="submit" disabled={saving} className="ui-button ui-button-primary mt-2 h-11 w-full">{saving ? <><Loader2 size={16} className="animate-spin" />Signing in...</> : <>Sign in to workspace<ArrowRight size={15} /></>}</button>
    </form>
    <p className="mt-7 text-center text-[11px] leading-relaxed text-slate-500">Need access? Contact your restaurant administrator.</p>
    <p className="mt-12 text-center text-[10px] text-slate-300">{profile.app_name} · Restaurant management, made simple.</p>
  </div>;
}
