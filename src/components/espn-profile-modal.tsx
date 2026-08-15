"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Player } from "@/types/database";
import { espnProfileUrl } from "@/lib/espn/profile-url";

interface EspnProfile {
  name: string | null;
  headshot: string | null;
  jersey: string | null;
  position: string | null;
  team: string | null;
  age: number | null;
  height: string | null;
  weight: string | null;
  college: string | null;
  experience: string | null;
  draft: string | null;
  birthPlace: string | null;
  status: string | null;
  statsLabel: string | null;
  stats: { abbreviation: string | null; displayName: string | null; displayValue: string | null; rank: string | null }[];
}

/**
 * Player name that opens the ESPN profile in a modal. Falls back to plain
 * text when the player has no linkable ESPN id (DEF, pre-espn_id players).
 */
export function EspnPlayerName({
  player,
  className = "hover:underline hover:text-accent",
  children,
}: {
  player: Player;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const url = espnProfileUrl(player);

  if (!url) return <>{children}</>;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && (
        <EspnProfileModal
          espnId={player.espn_id!}
          espnUrl={url}
          fallbackName={player.name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const POS_BADGE: Record<string, string> = {
  QB: "pos-qb", RB: "pos-rb", WR: "pos-wr", TE: "pos-te", DEF: "pos-def", K: "pos-def",
};

export function EspnProfileModal({
  espnId,
  espnUrl,
  fallbackName,
  onClose,
}: {
  espnId: string;
  espnUrl: string;
  fallbackName: string;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<EspnProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const resp = await fetch(`/api/players/espn/${espnId}`);
        if (resp.ok) setProfile(await resp.json());
      } catch {}
      setLoading(false);
    }
    load();
  }, [espnId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Portal to body — pick cells animate with transforms, which would trap a
  // fixed-position overlay inside the cell. Position comes via inline style:
  // globals.css sets `body > * { position: relative; z-index: 1 }` unlayered,
  // which beats Tailwind's layered `fixed`/`z-50` utilities on portaled nodes.
  return createPortal(
    <div
      className="bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ position: "fixed", inset: 0, zIndex: 50 }}
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted mt-3">Loading ESPN profile...</p>
          </div>
        ) : !profile ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-muted">Couldn&apos;t load the ESPN profile for {fallbackName}.</p>
            <a href={espnUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
              Open on ESPN ↗
            </a>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-5 pb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {profile.headshot && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.headshot}
                    alt={profile.name ?? fallbackName}
                    className="w-16 h-16 rounded-full bg-background/40 object-cover flex-shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <h2 className="text-lg font-black leading-tight truncate">
                    {profile.name ?? fallbackName}
                  </h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {profile.position && (
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${POS_BADGE[profile.position] ?? "bg-background/40"}`}>
                        {profile.position}
                      </span>
                    )}
                    <span className="text-xs text-muted font-medium truncate">
                      {[profile.team, profile.jersey].filter(Boolean).join(" · ")}
                    </span>
                    {profile.status && profile.status !== "Active" && (
                      <span className="text-[10px] text-danger font-semibold">{profile.status}</span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="text-muted hover:text-foreground text-xl leading-none p-1 flex-shrink-0">&times;</button>
            </div>

            {/* Bio grid */}
            <div className="px-5 grid grid-cols-3 gap-2">
              <BioItem label="Age" value={profile.age != null ? String(profile.age) : null} />
              <BioItem label="Height" value={profile.height} />
              <BioItem label="Weight" value={profile.weight} />
              <BioItem label="College" value={profile.college} />
              <BioItem label="Experience" value={profile.experience} />
              <BioItem label="Drafted" value={profile.draft} />
            </div>

            {/* Season stats */}
            {profile.stats.length > 0 && (
              <div className="px-5 pt-4">
                <div className="text-[10px] text-muted font-semibold uppercase tracking-wider mb-2">
                  {profile.statsLabel ?? "Season stats"}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {profile.stats.map((s, i) => (
                    <div key={i} className="flex items-center justify-between bg-background/30 rounded px-2.5 py-1.5">
                      <span className="text-[10px] text-muted">{s.displayName ?? s.abbreviation}</span>
                      <span className="text-xs font-bold font-mono">
                        {s.displayValue}
                        {s.rank && <span className="text-[9px] text-muted/70 font-normal ml-1.5">{s.rank}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer link to the full page */}
            <div className="p-5 pt-4">
              <a
                href={espnUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-xs font-semibold text-accent bg-accent/10 hover:bg-accent/20 rounded-lg py-2 transition-colors"
              >
                Full profile on ESPN ↗
              </a>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function BioItem({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="bg-background/30 rounded-lg p-2 text-center min-w-0">
      <div className="text-xs font-bold truncate" title={value}>{value}</div>
      <div className="text-[9px] text-muted uppercase tracking-wider">{label}</div>
    </div>
  );
}
