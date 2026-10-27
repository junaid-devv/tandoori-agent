import Image from "next/image";

/** One brand mark shared by the workspace and authentication screens. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="brand-lockup">
    <Image
      src={compact ? "/orderiq-symbol.png" : "/orderiq-wordmark.png"}
      alt="OrderIQ"
      width={compact ? 36 : 172}
      height={compact ? 36 : 40}
      className={compact ? "h-9 w-9 object-contain" : "h-10 w-[172px] object-contain"}
      loading="eager"
      unoptimized
    />
  </span>;
}
