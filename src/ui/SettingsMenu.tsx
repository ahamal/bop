// The settings dropdown, built on Radix Primitives (accessible, headless —
// focus, keyboard, outside-click, portaling all handled) and styled with
// Tailwind tokens so it follows light/dark. Heroicons throughout. Reads live
// values via useSettings; writes through settings.set() (persist + notify live
// in the store). Radix exposes state as data-attributes (data-[state=…]), which
// Tailwind targets directly.

import { type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Select from "@radix-ui/react-select";
import * as Slider from "@radix-ui/react-slider";
import * as Switch from "@radix-ui/react-switch";
import {
  Cog6ToothIcon,
  SwatchIcon,
  SunIcon,
  MoonIcon,
  ComputerDesktopIcon,
  MusicalNoteIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  SparklesIcon,
  ChevronDownIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import {
  settings,
  MUSIC_TRACKS,
  THEME_OPTIONS,
  type ThemePref,
} from "../settings.ts";
import { useSettings } from "./useSettings.ts";

export function SettingsMenu() {
  const s = useSettings();
  const muted = s.volume === 0;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-panel text-text shadow outline-none ring-1 ring-black/10 transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent dark:ring-white/10"
        >
          <Cog6ToothIcon className="h-5 w-5" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-md bg-panel p-4 text-text shadow-xl outline-none ring-1 ring-black/10 dark:ring-white/10"
        >
          <h2 className="mb-3 border-b border-black/10 pb-2.5 text-xs font-semibold uppercase tracking-wider text-muted dark:border-white/10">
            Settings
          </h2>

          <div className="space-y-5">
            <Field icon={SwatchIcon} label="Theme">
              <ThemeToggle
                value={s.theme}
                onChange={(v) => settings.set({ theme: v })}
              />
            </Field>

            <Field icon={MusicalNoteIcon} label="Music">
              <SettingSelect
                ariaLabel="Music"
                options={MUSIC_TRACKS}
                value={s.music}
                onValueChange={(v) => settings.set({ music: v })}
              />
            </Field>

            <Field
              icon={muted ? SpeakerXMarkIcon : SpeakerWaveIcon}
              label="Volume"
              value={`${Math.round(s.volume * 100)}%`}
            >
              <VolumeSlider
                value={s.volume}
                onChange={(v) => settings.set({ volume: v })}
              />
            </Field>

            <Field icon={SparklesIcon} label="Breathing guide" inline>
              <BreathingSwitch
                checked={s.breathing}
                onCheckedChange={(v) => settings.set({ breathing: v })}
              />
            </Field>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Heroicons all share this component type; use it for icon props.
type Icon = typeof SunIcon;

function Field({
  icon: IconCmp,
  label,
  value,
  inline,
  children,
}: {
  icon?: Icon;
  label: string;
  value?: string;
  inline?: boolean;
  children: ReactNode;
}) {
  const head = (
    <span className="flex items-center gap-1.5 text-sm text-muted">
      {IconCmp && <IconCmp className="h-4 w-4" />}
      {label}
    </span>
  );
  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3">
        {head}
        {children}
      </div>
    );
  }
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        {head}
        {value && (
          <span className="text-sm tabular-nums text-muted">{value}</span>
        )}
      </div>
      {children}
    </div>
  );
}

const THEME_ICON: Record<ThemePref, Icon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: ComputerDesktopIcon,
};

function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemePref;
  onChange: (v: ThemePref) => void;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix emits "" when an item is toggled off; ignore that so one always stays selected.
      onValueChange={(v) => {
        if (v) onChange(v as ThemePref);
      }}
      className="flex rounded-md bg-black/5 p-0.5 dark:bg-white/5"
    >
      {THEME_OPTIONS.map((o) => {
        const IconCmp = THEME_ICON[o.value];
        return (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            aria-label={o.label}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-sm font-medium text-text/70 outline-none transition hover:text-text focus-visible:ring-2 focus-visible:ring-accent data-[state=on]:bg-accent data-[state=on]:text-[#04140d]"
          >
            <IconCmp className="h-[18px] w-[18px]" />
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}

function SettingSelect<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <Select.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <Select.Trigger
        aria-label={ariaLabel}
        className="flex w-full items-center justify-between gap-2 rounded-md bg-black/5 px-3 py-2 text-sm text-text outline-none ring-1 ring-black/10 transition hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-accent dark:bg-white/5 dark:ring-white/10 dark:hover:bg-white/10"
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDownIcon className="h-4 w-4 text-muted" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          className="z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md bg-panel text-text shadow-xl ring-1 ring-black/10 dark:ring-white/10"
        >
          <Select.Viewport className="p-1">
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-sm py-2 pl-3 pr-8 text-sm outline-none data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/10"
              >
                <Select.ItemText>{o.label}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-2">
                  <CheckIcon className="h-4 w-4 text-accent" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function VolumeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Slider.Root
      value={[Math.round(value * 100)]}
      max={100}
      step={1}
      onValueChange={([v]) => onChange(v / 100)}
      className="relative flex h-5 w-full cursor-pointer touch-none select-none items-center"
    >
      <Slider.Track className="relative h-1 w-full grow rounded-full bg-black/10 dark:bg-white/10">
        <Slider.Range className="absolute h-full rounded-full bg-accent" />
      </Slider.Track>
      <Slider.Thumb
        aria-label="Volume"
        className="block h-4 w-4 rounded-full bg-accent shadow outline-none ring-2 ring-panel transition focus-visible:ring-accent"
      />
    </Slider.Root>
  );
}

function BreathingSwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="relative inline-flex h-6 w-11 items-center rounded-full bg-black/15 outline-none transition focus-visible:ring-2 focus-visible:ring-accent data-[state=checked]:bg-accent dark:bg-white/15"
    >
      <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </Switch.Root>
  );
}
