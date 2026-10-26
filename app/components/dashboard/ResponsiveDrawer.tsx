"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function ResponsiveDrawer({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const wide = window.matchMedia("(min-width: 1536px)");
    function update() {
      if (!dialog) return;
      if (dialog.open) dialog.close();
      if (wide.matches) dialog.show(); else dialog.showModal();
    }
    update();
    wide.addEventListener("change", update);
    return () => { wide.removeEventListener("change", update); if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget && event.clientX < event.currentTarget.getBoundingClientRect().left) onClose(); }} className="fixed inset-y-0 right-0 left-auto z-50 m-0 flex h-dvh max-h-none w-full max-w-sm shrink-0 flex-col overflow-hidden border-0 border-l border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/30 2xl:static 2xl:z-auto 2xl:h-auto 2xl:w-[300px] 2xl:shadow-none">{children}</dialog>;
}
