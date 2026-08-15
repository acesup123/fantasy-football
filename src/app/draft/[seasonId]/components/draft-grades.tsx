"use client";

import { useMemo, useState } from "react";
import {
  DRAFT_WEIGHTS,
  ROSTER_WEIGHTS,
  type DraftComponent,
  type RosterComponent,
  type TeamGrade,
} from "@/lib/draft/grade";
import { abbreviateName } from "@/lib/draft/roster-requirements";

interface DraftGradesProps {
  /** Graded once by the board and shared, so a pick replays the draft once. */
  grades: TeamGrade[];
  hasRanks: boolean;
  /**
   * Before the draft ends the headline letter is the curve — an absolute score
   * on a half-built roster reads as "everyone is failing". After it ends the
   * absolute letter is the honest one.
   */
  isDraftComplete: boolean;
  currentOwnerId?: string;
}

type SortKey = "roster" | "draft";

const DRAFT_PARTS: { key: DraftComponent; label: string; className: string }[] = [
  { key: "value", label: "Board value", className: "bg-grade-value" },
  { key: "keeper", label: "Keeper leverage", className: "bg-grade-keeper" },
  { key: "discipline", label: "Discipline", className: "bg-grade-depth" },
];

const ROSTER_PARTS: { key: RosterComponent; label: string; className: string }[] = [
  { key: "lineup", label: "Starting nine", className: "bg-grade-lineup" },
  { key: "superflex", label: "Superflex", className: "bg-grade-superflex" },
  { key: "depth", label: "Depth", className: "bg-grade-depth" },
  { key: "byes", label: "Byes", className: "bg-grade-keeper" },
];

function letterClass(letter: string): string {
  if (letter.startsWith("A")) return "text-grade-a";
  if (letter.startsWith("B")) return "text-grade-b";
  if (letter.startsWith("C")) return "text-grade-c";
  return "text-grade-d";
}

export function DraftGrades({
  grades,
  hasRanks,
  isDraftComplete,
  currentOwnerId,
}: DraftGradesProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("roster");

  const sorted = useMemo(
    () => [...grades].sort((a, b) => a[sortBy].rank - b[sortBy].rank),
    [grades, sortBy]
  );

  // The teams whose two grades disagree most — the story the split exists to tell.
  const biggestSplit = useMemo(() => {
    if (grades.length < 2) return null;
    return grades.reduce((a, b) =>
      Math.abs(b.draft.rank - b.roster.rank) > Math.abs(a.draft.rank - a.roster.rank)
        ? b
        : a
    );
  }, [grades]);

  if (grades.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted">
        No rosters to grade yet.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {!hasRanks && (
        <div className="rounded-md bg-warning/10 border border-warning/30 px-3 py-2">
          <p className="text-[11px] text-warning leading-snug">
            ESPN ranks unavailable — every player is being treated as replacement
            level, so these reflect roster shape only, not player value.
          </p>
        </div>
      )}

      {/* What the two grades mean, and the sort control */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-xl">
          <p className="text-[11px] text-muted leading-relaxed">
            <span className="text-foreground font-bold">Draft</span> grades the
            process — given the board in front of you at each pick, did you
            choose well? Keepers are excluded; you didn&apos;t draft them.{" "}
            <span className="text-foreground font-bold">Roster</span> grades what
            you now own, keepers included. They diverge on purpose.
          </p>
          {!isDraftComplete && (
            <p className="text-[11px] text-warning leading-relaxed">
              The draft is still running, so the letters are curved against the
              league right now — B is the field average. They switch to absolute
              scores once the draft finishes.
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-muted uppercase tracking-wide">
            Sort
          </span>
          <div className="flex rounded-md bg-background/60 p-0.5">
            {(["roster", "draft"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setSortBy(k)}
                className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide transition-all ${
                  sortBy === k
                    ? "bg-accent text-on-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Column headings */}
      <div className="hidden sm:grid grid-cols-[2rem_1fr_1fr] gap-3 px-2 text-[9px] uppercase tracking-wider text-muted font-bold">
        <span />
        <span>Draft — how you picked</span>
        <span>Roster — what you own</span>
      </div>

      <div className="border border-border rounded-lg overflow-hidden divide-y divide-border/40">
        {sorted.map((g) => (
          <GradeRow
            key={g.ownerId}
            grade={g}
            useCurve={!isDraftComplete}
            isMe={g.ownerId === currentOwnerId}
            isOpen={expanded === g.ownerId}
            onToggle={() =>
              setExpanded(expanded === g.ownerId ? null : g.ownerId)
            }
          />
        ))}
      </div>

      {biggestSplit &&
        Math.abs(biggestSplit.draft.rank - biggestSplit.roster.rank) >= 3 && (
          <p className="text-[11px] text-muted leading-relaxed">
            <span className="text-foreground font-bold">
              {biggestSplit.teamName}
            </span>{" "}
            is the widest split — {ordinal(biggestSplit.draft.rank)} on the draft,{" "}
            {ordinal(biggestSplit.roster.rank)} on the roster.{" "}
            {biggestSplit.draft.rank < biggestSplit.roster.rank
              ? "Drafted better than the roster shows, which usually means a thin starting position."
              : "Owns more than the draft earned, which usually means the keepers did the work."}
          </p>
        )}

      <p className="text-[10px] text-muted leading-relaxed max-w-2xl">
        Weighted for this league, not a generic one: 24 of the ~32 startable NFL
        quarterbacks start every week here, so the superflex room carries more
        weight than value-over-ADP. Grades within ~5 points are a tie. This
        measures process and shape against your rules — not projected points.
      </p>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function GradeRow({
  grade,
  useCurve,
  isMe,
  isOpen,
  onToggle,
}: {
  grade: TeamGrade;
  useCurve: boolean;
  isMe: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const qbCount = grade.qbRoom.length;

  return (
    <div className={isMe ? "bg-accent/5" : ""}>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full px-3 py-2.5 text-left hover:bg-card-hover/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 sm:flex-none sm:w-36">
            <span className="block text-xs font-bold truncate">
              {grade.teamName}
            </span>
            <span className="block text-[9px] text-muted uppercase tracking-wide mt-0.5">
              {qbCount} QB{qbCount === 1 ? " — superflex hole" : ""}
              {grade.keeperCount > 0 ? ` · ${grade.keeperCount} kept` : ""}
            </span>
          </span>

          <div className="hidden sm:grid flex-1 grid-cols-2 gap-3">
            <GradeCell
              block={grade.draft}
              letter={useCurve ? grade.curve.draft.letter : grade.draft.letter}
              parts={DRAFT_PARTS}
              weights={DRAFT_WEIGHTS}
            />
            <GradeCell
              block={grade.roster}
              letter={useCurve ? grade.curve.roster.letter : grade.roster.letter}
              parts={ROSTER_PARTS}
              weights={ROSTER_WEIGHTS}
            />
          </div>

          {/* Stacked on small screens */}
          <div className="sm:hidden flex items-center gap-3">
            <MiniGrade
              label="Draft"
              letter={useCurve ? grade.curve.draft.letter : grade.draft.letter}
            />
            <MiniGrade
              label="Roster"
              letter={useCurve ? grade.curve.roster.letter : grade.roster.letter}
            />
          </div>
        </div>
      </button>

      {isOpen && <GradeDetail grade={grade} />}
    </div>
  );
}

function GradeCell({
  block,
  letter,
  parts,
  weights,
}: {
  block: TeamGrade["draft"] | TeamGrade["roster"];
  letter: string;
  parts: { key: string; label: string; className: string }[];
  weights: Record<string, number>;
}) {
  const components = block.components as Record<string, number>;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] text-muted font-mono tabular-nums w-4 flex-shrink-0">
        {block.rank}
      </span>
      <span
        className={`text-base font-black tracking-tight w-8 flex-shrink-0 ${letterClass(letter)}`}
      >
        {letter}
      </span>
      <span className="flex-1 min-w-0 h-3 rounded-sm bg-background/40 flex overflow-hidden">
        {parts.map((p) => (
          <span
            key={p.key}
            className={p.className}
            style={{ width: `${components[p.key]}%` }}
            title={`${p.label}: ${components[p.key]} / ${weights[p.key]}`}
          />
        ))}
      </span>
      <span className="text-xs font-black tabular-nums w-7 text-right flex-shrink-0">
        {Math.round(block.score)}
      </span>
    </div>
  );
}

function MiniGrade({ label, letter }: { label: string; letter: string }) {
  return (
    <span className="text-center">
      <span className="block text-[8px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <span className={`block text-base font-black ${letterClass(letter)}`}>
        {letter}
      </span>
    </span>
  );
}

function GradeDetail({ grade }: { grade: TeamGrade }) {
  const { bestValue, biggestReach, byeCollision } = grade;

  return (
    <div className="px-3 pb-3 pt-1 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Panel
          title="Draft"
          rank={grade.draft.rank}
          letter={grade.draft.letter}
          verdict={grade.draftVerdict}
          parts={DRAFT_PARTS}
          components={grade.draft.components as Record<string, number>}
          weights={DRAFT_WEIGHTS}
        >
          <div className="grid grid-cols-2 gap-2">
            <Fact label="Best pick">
              {bestValue && bestValue.passedOver !== null ? (
                <>
                  {abbreviateName(bestValue.player.name)}
                  <span className="block text-muted text-[10px]">
                    {bestValue.passedOver === 0
                      ? "best available"
                      : `${bestValue.passedOver} better left`}
                  </span>
                </>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Biggest reach">
              {biggestReach && biggestReach.passedOver !== null ? (
                <>
                  {abbreviateName(biggestReach.player.name)}
                  <span className="block text-muted text-[10px]">
                    passed on{" "}
                    <span className="text-grade-d font-bold">
                      {biggestReach.passedOver}
                    </span>{" "}
                    better
                  </span>
                </>
              ) : (
                "—"
              )}
            </Fact>
          </div>
        </Panel>

        <Panel
          title="Roster"
          rank={grade.roster.rank}
          letter={grade.roster.letter}
          verdict={grade.rosterVerdict}
          parts={ROSTER_PARTS}
          components={grade.roster.components as Record<string, number>}
          weights={ROSTER_WEIGHTS}
        >
          <div className="grid grid-cols-2 gap-2">
            <Fact label="QB room">
              {grade.qbRoom.length > 0
                ? grade.qbRoom.map((p) => abbreviateName(p.name)).join(" · ")
                : "none"}
            </Fact>
            <Fact label="Bye exposure">
              {byeCollision
                ? `${byeCollision.count} starters · wk ${byeCollision.week}`
                : "none"}
            </Fact>
          </div>

          <div className="mt-2">
            <div className="text-[9px] uppercase tracking-wider text-muted font-bold mb-1">
              Starting nine
            </div>
            <div className="flex flex-wrap gap-1">
              {grade.starters.map((s, i) => (
                <span
                  key={`${s.slot}-${i}`}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-background/50 border border-border/50"
                >
                  <span className="text-muted font-bold">{s.slot}</span>{" "}
                  {s.player ? (
                    abbreviateName(s.player.name)
                  ) : (
                    <span className="text-danger">empty</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  rank,
  letter,
  verdict,
  parts,
  components,
  weights,
  children,
}: {
  title: string;
  rank: number;
  letter: string;
  verdict: string;
  parts: { key: string; label: string; className: string }[];
  components: Record<string, number>;
  weights: Record<string, number>;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border/60 rounded-lg p-2.5 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-widest font-bold text-muted">
          {title}
        </span>
        <span className={`text-lg font-black ${letterClass(letter)}`}>
          {letter}
        </span>
        <span className="text-[10px] text-muted font-mono">
          {ordinal(rank)} of 12
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-foreground/80">{verdict}</p>

      <div className="flex flex-wrap gap-1.5">
        {parts.map((p) => (
          <span
            key={p.key}
            className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 flex items-center gap-1.5"
          >
            <span className={`w-1.5 h-1.5 rounded-sm ${p.className}`} />
            <span className="text-muted">{p.label}</span>
            <span className="font-bold tabular-nums">{components[p.key]}</span>
            <span className="text-muted/60">/{weights[p.key]}</span>
          </span>
        ))}
      </div>

      {children}
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background/30 border border-border/50 rounded px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted font-bold">
        {label}
      </div>
      <div className="text-[11px] mt-0.5 leading-snug">{children}</div>
    </div>
  );
}
