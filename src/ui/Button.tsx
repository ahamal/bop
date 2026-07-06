// The app's shared pill button. Variants: primary (solid black — the home
// screen's Begin look), outline (bordered, transparent), quiet (borderless
// text link). WHITE_SURFACE is exported for composites that sit on a white
// pill instead (the reminder split button).

import type { ButtonHTMLAttributes } from "react";

// White in both modes; the ring keeps it visible on the light background.
export const WHITE_SURFACE =
  "bg-white text-[#0d1117] shadow-lg shadow-black/10 ring-1 ring-black/10";

const VARIANTS = {
  // In dark mode the solid-black pill disappears into the page, so primary
  // falls back to the outline look there (ring, not border, to avoid a size
  // shift between themes).
  primary:
    "bg-[#1f2937] text-white shadow-lg shadow-black/20 hover:opacity-90 dark:bg-transparent dark:text-text dark:shadow-none dark:ring-1 dark:ring-inset dark:ring-white/15 dark:hover:bg-white/10 dark:hover:opacity-100",
  outline:
    "border border-black/15 text-text hover:bg-black/5 disabled:hover:bg-transparent dark:border-white/15 dark:hover:bg-white/10",
  quiet: "text-muted hover:text-text",
} as const;

const SIZES = {
  sm: "px-5 py-2.5 text-xs",
  md: "px-6 py-2.5 text-sm",
  lg: "px-8 py-3 text-lg",
} as const;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
};

export function Button({ variant = "outline", size = "sm", className = "", ...props }: Props) {
  return (
    <button
      className={`rounded-full font-semibold uppercase tracking-wide outline-none transition disabled:cursor-default disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
