"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "subtle";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}

const styles: Record<Variant, string> = {
  primary: "bg-gold-400 text-ink font-semibold hover:bg-gold-500 disabled:opacity-50",
  ghost: "border border-white/15 text-ivory hover:bg-white/5 disabled:opacity-40",
  subtle: "bg-white/8 text-ivory hover:bg-white/12 disabled:opacity-40",
};

export function Button({ variant = "primary", loading, children, className = "", disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[15px] transition-colors ${styles[variant]} ${className}`}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}
