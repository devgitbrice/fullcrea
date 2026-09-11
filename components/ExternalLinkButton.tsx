"use client";

import type { ReactNode } from "react";

export default function ExternalLinkButton({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Ouvrir ${href.replace(/^https?:\/\//, "")}`}
      className="flex h-9 items-center gap-1.5 rounded-md border border-gray-800 bg-gray-950/90 px-3 text-xs font-medium text-gray-200 shadow-lg backdrop-blur-sm transition-colors hover:bg-gray-800"
    >
      {icon}
      {label}
    </a>
  );
}
