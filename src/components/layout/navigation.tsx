"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/draft", label: "Draft" },
  { href: "/keepers", label: "Keepers" },
  { href: "/trades", label: "Trades" },
  { href: "/owners", label: "Owners" },
  { href: "/history", label: "History" },
];

export function Navigation() {
  const pathname = usePathname();
  const isDraftLive = pathname.startsWith("/draft/");
  const { user, owner, isAdmin, adminMode, toggleAdminMode, signOut, loading } = useAuth();

  return (
    <header
      className={`border-b bg-card-elevated/80 backdrop-blur-md sticky top-0 z-40 ${
        isDraftLive ? "border-accent/30" : adminMode ? "border-warning/40" : "border-border"
      }`}
    >
      {/* Admin mode banner */}
      {adminMode && (
        <div className="bg-warning/10 border-b border-warning/20 px-4 py-1 text-center">
          <span className="text-[10px] font-bold text-warning uppercase tracking-wider">
            Admin Mode — You can edit all teams
          </span>
        </div>
      )}

      <div className="max-w-[1600px] mx-auto px-4 md:px-6 flex items-center h-12 gap-4">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 font-black text-base whitespace-nowrap group"
        >
          <span className="text-accent group-hover:scale-110 transition-transform inline-block">
            BANL
          </span>
        </Link>

        <div className="w-px h-5 bg-border" />

        {/* Nav */}
        <nav className="flex items-center gap-0.5 overflow-x-auto flex-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-accent/15 text-accent shadow-sm"
                    : "text-muted hover:text-foreground hover:bg-card-hover"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          {/* Admin link — only for commissioners */}
          {isAdmin && (
            <Link
              href="/admin"
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                pathname.startsWith("/admin")
                  ? "bg-warning/15 text-warning shadow-sm"
                  : "text-muted hover:text-foreground hover:bg-card-hover"
              }`}
            >
              Admin
            </Link>
          )}
        </nav>

        {/* Draft Live indicator */}
        {isDraftLive && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 border border-accent/30 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-[10px] font-bold text-accent uppercase tracking-wider">
              Live
            </span>
          </div>
        )}

        {/* Right side: user info + admin toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Admin mode toggle */}
          {isAdmin && (
            <button
              onClick={toggleAdminMode}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                adminMode
                  ? "bg-warning/20 text-warning border border-warning/40"
                  : "bg-card-hover text-muted border border-transparent hover:text-foreground"
              }`}
            >
              {adminMode ? "Admin ON" : "Admin"}
            </button>
          )}

          {/* User info */}
          {loading ? (
            <div className="w-20 h-6 shimmer rounded" />
          ) : user && owner ? (
            <div className="flex items-center gap-2">
              <div className="text-right hidden sm:block">
                <div className="text-[10px] font-semibold leading-tight">
                  {owner.name.split(" ")[0]}
                </div>
                <div className="text-[9px] text-muted leading-tight truncate max-w-[80px]">
                  {owner.team_name}
                </div>
              </div>
              <button
                onClick={signOut}
                className="text-[10px] text-muted hover:text-danger transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="btn-primary text-[10px] px-3 py-1"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
