"use client";

const CLAUDE_SESSION_URL = "https://claude.ai/code/session_01SXPkzvuBCAVQMNfU7Xnusz";
const VERCEL_URL = "https://vercel.com/bricems-projects/fullcrea-7a5t/deployments";
const SUPABASE_URL = "https://supabase.com/dashboard/project/lomgelwpxlzynuogxsri";

function QuickLinkButton({
  label,
  title,
  href,
}: {
  label: string;
  title: string;
  href?: string;
}) {
  const className =
    "flex h-10 w-10 items-center justify-center rounded-full border border-gray-800 bg-gray-950 text-sm font-semibold text-gray-200 shadow-2xl transition-colors hover:bg-gray-800";

  if (!href) {
    return (
      <button type="button" title={title} disabled className={`${className} cursor-not-allowed opacity-50`}>
        {label}
      </button>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={className}>
      {label}
    </a>
  );
}

export default function QuickLinks() {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <QuickLinkButton label="C" title="Claude (à venir)" href={CLAUDE_SESSION_URL} />
      <QuickLinkButton label="V" title="Vercel — Déploiements" href={VERCEL_URL} />
      <QuickLinkButton label="S" title="Supabase — Dashboard" href={SUPABASE_URL} />
    </div>
  );
}
