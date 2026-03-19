"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";

export default function LoginPage() {
  const { signIn, user, owner } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    setError(null);
    setLoading(true);

    const result = await signIn(email);
    if (result.error) {
      setError(result.error);
    } else {
      setSent(true);
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
        <button
          onClick={() => { setSent(false); setEmail(""); }}
          className="text-xs text-muted hover:text-accent"
        >
          Use a different email
        </button>
      </div>
    );
  }

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
          disabled={loading || !email}
          className={`btn-primary w-full py-2.5 ${loading ? "opacity-50" : ""}`}
        >
          {loading ? "Sending..." : "Send Magic Link"}
        </button>

        <p className="text-[10px] text-muted text-center">
          Only league members can sign in. Use the email registered with your team.
        </p>
      </form>
    </div>
  );
}
