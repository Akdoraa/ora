"use client";

import { useState } from "react";

export function CopyBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => {
          navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          });
        }}
        aria-label="Copy code to clipboard"
        className="absolute right-3 top-3 rounded-md border border-line-strong bg-card px-2 py-1 font-mono text-[11px] text-muted hover:bg-sky-50"
      >
        {copied ? "copied ✓" : "copy"}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
      <pre className="overflow-x-auto bg-[#faf9f5] px-5 py-4 font-mono text-[12px] leading-relaxed text-ink-soft">
        <code data-lang={lang}>{code}</code>
      </pre>
    </div>
  );
}
