"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { Brand } from "@/app/components/Brand";

export function LoginForm() {
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

  return <div className="login-card w-full max-w-[420px]">
    <div className="mb-8"><Brand /></div>
    <h1 className="text-[28px] font-semibold tracking-[-1px] text-slate-900">Welcome back</h1>
    <p className="mt-2 text-[13px] text-slate-500">Sign in to your restaurant workspace.</p>
    <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">{error}</p>}
      <label className="block"><span className="ui-label">Username or email</span><input required type="text" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} className="ui-input h-11" placeholder="Enter your username or email" disabled={saving} /></label>
      <label className="block"><span className="ui-label">Password</span><div className="relative"><input required type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="ui-input ui-input-action h-11" placeholder="Enter your password" disabled={saving} /><button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)} className="absolute top-1 right-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50">{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
      <button type="submit" disabled={saving} className="ui-button ui-button-primary mt-2 h-11 w-full">{saving ? <><Loader2 size={16} className="animate-spin" />Signing in...</> : <>Sign in to workspace<ArrowRight size={15} /></>}</button>
    </form>
    <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-500">Need access? Contact your administrator.</p>
  </div>;
}
