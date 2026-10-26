import { redirect } from "next/navigation";
import { ArrowUpRight, CheckCircle2, MessageSquare, ShoppingBag, TrendingUp, UtensilsCrossed } from "lucide-react";
import { getDashboardSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getDashboardSession();
  if (session) redirect("/dashboard");
  return <main className="grid min-h-dvh bg-white lg:grid-cols-2">
    <div className="hidden flex-col justify-between overflow-hidden border-r border-orange-100 bg-[#fff8f2] p-12 lg:flex xl:p-16">
      <div className="flex items-center gap-2 text-xs font-medium text-orange-800/60"><UtensilsCrossed size={17} />Built for the way restaurants work.</div>
      <div className="mx-auto my-12 w-full max-w-lg"><p className="text-[11px] font-medium uppercase tracking-[0.17em] text-brand">Less juggling. More serving.</p><h2 className="mt-5 text-[44px] font-semibold leading-[1.15] tracking-[-1.8px] text-slate-900 xl:text-[54px]">Great service.<br />One workspace.</h2><p className="mt-5 max-w-sm text-sm leading-7 text-slate-500">Bring your orders, customer conversations and daily operations together. Keep your attention where it belongs.</p>
        <div className="mt-10 space-y-3 rounded-2xl border border-orange-200/60 bg-white/80 p-5 shadow-[0_12px_40px_-24px_#9a3412] xl:p-6"><div className="mb-5 flex items-center justify-between"><span className="text-xs font-semibold text-slate-700">Everything in its place</span><span className="rounded-lg bg-orange-50 p-1.5 text-brand"><ArrowUpRight size={15} /></span></div>{[{icon: ShoppingBag,title:"Orders, from first tap to doorstep",text:"A clear view of every order."},{icon:MessageSquare,title:"Conversations that feel personal",text:"Your team and AI, working together."},{icon:TrendingUp,title:"Insights to grow your business",text:"Understand what your customers love."}].map(({icon:Icon,title,text}) => <div key={title} className="flex items-center gap-3 border-t border-slate-100 pt-4 pb-1"><span className="rounded-xl bg-slate-50 p-2.5 text-slate-500"><Icon size={18} strokeWidth={1.5} /></span><div><p className="text-xs font-medium text-slate-700">{title}</p><p className="mt-1 text-[11px] text-slate-500">{text}</p></div><CheckCircle2 size={15} className="ml-auto text-emerald-500" /></div>)}</div>
      </div>
      <p className="text-[11px] text-orange-900/35">OrderIQ · A calmer way to run your restaurant.</p>
    </div>
    <div className="flex items-center justify-center px-6 py-12 sm:px-12"><LoginForm profile={{app_name: process.env.NEXT_PUBLIC_APP_NAME || "OrderIQ", logo_url: null}} /></div>
  </main>;
}
