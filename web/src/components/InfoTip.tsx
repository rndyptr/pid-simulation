export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex items-center ml-1.5 align-middle">
      <span
        tabIndex={0}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/50 text-[9px] leading-none text-muted-foreground cursor-help select-none outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        i
      </span>
      <span className="pointer-events-none absolute left-1/2 bottom-full z-40 mb-2 w-56 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] leading-snug text-foreground opacity-0 shadow-md transition-opacity group-hover/tip:opacity-100 group-focus-within/tip:opacity-100">
        {text}
      </span>
    </span>
  );
}
