// The shared top-left back control used on every subpage (info + dev): a back
// arrow with the "bop" wordmark beside it, so the affordance — and the way home
// — is identical everywhere. Defaults to navigating home; pass `onBack` when the
// screen needs to run teardown first (e.g. stopping a camera session).

import { ArrowLeftIcon } from "@heroicons/react/24/outline";

export function BackBar({ onBack }: { onBack?: () => void }) {
  const goBack = onBack ?? (() => { window.location.hash = ""; });
  return (
    <button
      onClick={goBack}
      aria-label="Back to home"
      className="group absolute left-4 top-4 z-10 inline-flex items-center gap-2"
    >
      <ArrowLeftIcon className="h-5 w-5 text-muted transition group-hover:text-text" />
      <span className="text-lg font-bold tracking-tight">bop</span>
    </button>
  );
}
