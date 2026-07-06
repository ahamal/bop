// Reminder scheduling for the completion screen: a delay dropdown reading as
// the full sentence ("Notify me again in 2 hours"; day choices reveal a time
// field below), with a "Remind me" button under it that schedules the push via
// scheduleReminder(). The dropdown is a transparent native select over an
// outline pill, so it looks like the app's buttons but the picker UX stays
// native. Renders nothing where push isn't supported. Dev builds get an extra
// "in 2 minutes" choice for the local end-to-end test.

import { useState } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { Button } from "./Button.tsx";
import { remindersSupported, scheduleReminder } from "../notify/reminders.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// A choice is either a fixed delay from now, or "days from now at hh:mm".
// Labels complete the sentence "Remind me …".
type Choice = { label: string; delayMs?: number; days?: number };

// Day choices past tomorrow are labeled with the actual weekday.
const dayLabel = (days: number): string =>
  days === 1
    ? "tomorrow"
    : "on " + new Date(Date.now() + days * DAY_MS).toLocaleDateString(undefined, { weekday: "long" });

const choices = (): Record<string, Choice> => ({
  ...(import.meta.env.DEV ? { "2m": { label: "in 2 minutes (dev)", delayMs: 2 * 60 * 1000 } } : {}),
  "1h": { label: "in 1 hour", delayMs: HOUR_MS },
  "2h": { label: "in 2 hours", delayMs: 2 * HOUR_MS },
  "4h": { label: "in 4 hours", delayMs: 4 * HOUR_MS },
  "8h": { label: "in 8 hours", delayMs: 8 * HOUR_MS },
  d1: { label: dayLabel(1), days: 1 },
  d2: { label: dayLabel(2), days: 2 },
  d3: { label: dayLabel(3), days: 3 },
});

// Notification body, picked at random per schedule. The neck as a character
// politely getting in touch — playful, never bossy.
const NUDGES = [
  "Your neck called. It wants to move again.",
  "Message from your neck: it misses the view over your shoulder.",
  "Your neck left a note: out for a stretch?",
  "Your neck is asking about those slow circles you two used to do.",
  "It's your neck. It wants to try that looking-around thing again.",
  "Your neck says it's been sitting still long enough.",
  "Your shoulders and your neck have been talking about you.",
];

type Status = "idle" | "busy" | "done" | "failed";

export function ReminderScheduler() {
  const [key, setKey] = useState("2h");
  const [time, setTime] = useState("09:00");
  const [status, setStatus] = useState<Status>("idle");

  if (!remindersSupported()) return null;
  const options = choices();
  const choice = options[key];

  const schedule = async (): Promise<void> => {
    let delayMs: number;
    if (choice.days) {
      const [h, m] = time.split(":").map(Number);
      const target = new Date();
      target.setDate(target.getDate() + choice.days);
      target.setHours(h, m, 0, 0);
      delayMs = target.getTime() - Date.now();
    } else {
      delayMs = choice.delayMs!;
    }
    setStatus("busy");
    const ok = await scheduleReminder(delayMs, {
      title: "bop",
      body: NUDGES[(Math.random() * NUDGES.length) | 0],
    });
    setStatus(ok ? "done" : "failed");
  };

  if (status === "done") {
    return <p className="text-xs font-medium text-text">Reminder set — see you then.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* The delay dropdown, reading as the full sentence ("Notify me again
          in 2 hours"). It is ONLY a picker — an invisible native select covers
          the pill, so anywhere on it opens the picker; the button below
          schedules. */}
      <div className="relative flex items-center gap-1.5 rounded-full border border-black/15 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-text transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">
        Notify me again {choice.label}
        <ChevronDownIcon className="h-3.5 w-3.5" />
        <select
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setStatus("idle");
          }}
          aria-label="Change reminder time"
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {Object.entries(options).map(([k, c]) => (
            <option key={k} value={k}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {choice.days && (
        <label className="flex items-baseline gap-2 text-sm text-muted">
          at
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setStatus("idle");
            }}
            className="cursor-pointer rounded-md bg-transparent px-1.5 py-0.5 text-center text-sm font-semibold text-text outline-none transition hover:bg-black/5 dark:hover:bg-white/10 dark:[color-scheme:dark]"
          />
        </label>
      )}
      <Button variant="primary" onClick={schedule} disabled={status === "busy"}>
        {status === "busy" ? "Scheduling…" : "Set reminder"}
      </Button>
      {status === "failed" && (
        <p className="text-xs text-red-500">Couldn't schedule — check notification permission.</p>
      )}
    </div>
  );
}
