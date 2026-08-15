"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";

/** Supabase enforces ~60s between magic links to the same address. */
const RESEND_COOLDOWN_SECONDS = 60;

function friendlyError(code: string | null, message: string): string {
  switch (code) {
    case "over_email_send_rate_limit":
      return "The league's sign-in emails have hit their hourly limit. Wait a few minutes and try again — or ask the commissioner if it keeps happening.";
    case "over_request_rate_limit":
      return "Too many sign-in attempts. Give it a minute, then try again.";
    case "otp_expired":
      return "That link expired. Request a fresh one below.";
    default:
      // Older SDK responses may not carry a code — fall back to the text.
      if (/rate limit/i.test(message)) {
        return "The league's sign-in emails have hit their hourly limit. Wait a few minutes and try again — or ask the commissioner if it keeps happening.";
      }
      return message;
  }
}

function LoginForm() {
  const { signIn, user, owner } = useAuth();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // A dead or already-used magic link bounces back here rather than dumping
  // the owner on the dashboard looking signed out.
  useEffect(() => {
    if (searchParams.get("error") === "link_invalid") {
      setError("That sign-in link didn't work — it may have expired or already been used. Request a new one below.");
    }
  }, [searchParams]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (user && owner) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center space-y-4">
        <div className="text-4xl">🏈</div>
        <h1 className="text-2xl font-black">Welcome back, {owner.name}</h1>
        <p className="text-muted text-sm">{owner.team_name}</p>
        <a href="/" className="btn-primary inline-block px-6 py-2">
          Go to Dashboard
        </a>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || cooldown > 0) return;

    setError(null);
    setLoading(true);

    const result = await signIn(email);
    if (result.error) {
      setError(friendlyError(result.code, result.error));
      // Only back off when the attempt actually consumed a send. A typo or a
      // non-member address never reached Supabase, so there's nothing to
      // protect and no reason to make them wait.
      if (result.throttle) {
        setCooldown(result.retryAfter ?? RESEND_COOLDOWN_SECONDS);
      }
    } else {
      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
    setLoading(false);
  };

  if (sent) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center space-y-4">
        <div className="text-4xl">📧</div>
        <h1 className="text-2xl font-black">Check your email</h1>
        <p className="text-muted text-sm">
          We sent a magic link to <span className="text-foreground font-semibold">{email}</span>.
          Click it to sign in.
        </p>
        <p className="text-xs text-muted">
          It can take a minute to arrive — check spam before requesting another.
        </p>
        <button
          onClick={() => { setSent(false); setEmail(""); setError(null); }}
          className="text-xs text-muted hover:text-accent"
        >
          Use a different email
        </button>
      </div>
    );
  }

  const blocked = loading || !email || cooldown > 0;

  return (
    <div className="max-w-md mx-auto mt-20 space-y-6">
      <div className="text-center">
        <div className="text-4xl mb-3">🏈</div>
        <h1 className="text-2xl font-black">BANL Fantasy Football</h1>
        <p className="text-muted text-sm mt-1">Sign in with your league email</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
        </div>

        {error && (
          <p className="text-xs text-danger">{error}</p>
        )}

        <button
          type="submit"
          disabled={blocked}
          className={`btn-primary w-full py-2.5 ${blocked ? "opacity-50" : ""}`}
        >
          {loading
            ? "Sending..."
            : cooldown > 0
              ? `Try again in ${cooldown}s`
              : "Send Magic Link"}
        </button>

        <p className="text-[10px] text-muted text-center">
          Only league members can sign in. Use the email registered with your team.
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto mt-20 text-center text-4xl">🏈</div>}>
      <LoginForm />
    </Suspense>
  );
}
