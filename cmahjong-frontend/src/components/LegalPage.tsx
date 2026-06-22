import Link from "next/link";

/** Shared shell for static legal pages (Terms / Privacy). */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">
      <Link href="/" className="text-sm text-gold-400">
        ‹ Back to cMahjong
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
      <div className="mt-5 space-y-4 text-sm leading-relaxed text-ivory/70 [&_h2]:mt-6 [&_h2]:font-semibold [&_h2]:text-ivory">
        {children}
      </div>
    </div>
  );
}
