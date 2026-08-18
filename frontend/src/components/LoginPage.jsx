import React from "react";
import { useAuth } from "../lib/AuthContext";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  const { login, error } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [localErr, setLocalErr] = React.useState("");

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setLocalErr("");
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setLocalErr(typeof detail === "string" ? detail : (err?.message || "Login failed"));
    } finally {
      setBusy(false);
    }
  };

  const shownErr = localErr || error;

  return (
    <div
      data-testid="login-page"
      className="min-h-screen flex items-center justify-center bg-[#F4F4F0] px-4"
    >
      <div className="w-full max-w-md">
        <div className="flex items-center gap-4 mb-8">
          <img src="/evolvebpm-logo.png" alt="EvolveBPM" className="h-16 w-auto" />
          <div>
            <div className="font-label">EVCL · Operations</div>
            <h1 className="font-serif-display text-3xl italic mt-1">
              RFP Master <span className="not-italic">Tracking</span>
            </h1>
          </div>
        </div>
        <div className="panel p-8">
          <div className="font-label">Sign In</div>
          <h2 className="font-serif-display text-3xl mt-2 mb-6">Welcome back</h2>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="font-label block mb-2">Email</label>
              <input
                data-testid="login-email"
                type="email"
                autoComplete="username"
                className="evcl-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@evolvebpm.com"
                required
              />
            </div>
            <div>
              <label className="font-label block mb-2">Password</label>
              <input
                data-testid="login-password"
                type="password"
                autoComplete="current-password"
                className="evcl-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {shownErr && (
              <div
                data-testid="login-error"
                className="text-[#D92D20] font-mono-tight text-sm"
              >
                {shownErr}
              </div>
            )}
            <button
              data-testid="login-submit"
              type="submit"
              className="btn-primary w-full"
              disabled={busy}
            >
              <LogIn size={14} strokeWidth={1.5} className="inline mr-1" />
              {busy ? "[ Signing in… ]" : "[ Sign In ]"}
            </button>
          </form>
          <div className="font-mono-tight text-[11px] text-[#666] mt-6 border-t border-[#DCDCCF] pt-4">
            Contact your administrator if you need access. Public registration is disabled.
          </div>
        </div>
      </div>
    </div>
  );
}
