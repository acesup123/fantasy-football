"use client";

import { useTheme } from "@/components/theme/theme-provider";
import type { Theme } from "@/types/database";

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: "system",
    label: "Match system",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 14h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3" aria-hidden="true">
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3" aria-hidden="true">
        <path
          d="M13.5 9.6A5.8 5.8 0 016.4 2.5a5.8 5.8 0 107.1 7.1z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

/**
 * Three-way theme control. Rendered as a radiogroup rather than a two-state
 * switch because "system" is a real third choice, not the absence of a choice.
 */
export function ThemeToggle() {
  const { theme, setTheme, ready } = useTheme();

  // Until the stored preference is read, every segment would render unselected
  // and then jump — show the same placeholder the nav uses for the user block.
  if (!ready) {
    return <div className="w-[72px] h-6 shimmer rounded-lg" aria-hidden="true" />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="flex items-center gap-0.5 p-0.5 rounded-lg bg-card-hover border border-border"
    >
      {OPTIONS.map((option) => {
        const isActive = theme === option.value;

        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={isActive}
            aria-label={option.label}
            title={option.label}
            onClick={() => setTheme(option.value)}
            className={`p-1 rounded-md transition-all ${
              isActive
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
