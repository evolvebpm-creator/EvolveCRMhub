import React from "react";
import "@/App.css";
import { fetchReference, authChangePassword } from "@/lib/apiClient";
import { AuthProvider, useAuth, canEdit, canAdmin } from "@/lib/AuthContext";
import Dashboard from "@/components/Dashboard";
import RFPForm from "@/components/RFPForm";
import RFPList from "@/components/RFPList";
import Proposal from "@/components/Proposal";
import Admin from "@/components/Admin";
import LoginPage from "@/components/LoginPage";
import { LogOut, KeyRound } from "lucide-react";

const BASE_TABS = [
  { key: "dashboard", label: "[ 01 / Dashboard ]" },
  { key: "form", label: "[ 02 / RFP Tracker ]", roles: ["editor", "admin"] },
  { key: "list", label: "[ 03 / All RFPs ]" },
  { key: "admin", label: "[ 04 / Admin ]", roles: ["admin"] },
];

function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [err, setErr] = React.useState("");
  const [ok, setOk] = React.useState(false);
  const submit = async () => {
    setErr("");
    if (next.length < 8) { setErr("New password must be at least 8 characters."); return; }
    try {
      await authChangePassword(current, next);
      setOk(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  };
  return (
    <div data-testid="change-password-modal" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="panel p-6 md:p-8 max-w-md w-full">
        <div className="font-label">Account</div>
        <h3 className="font-serif-display text-2xl mt-1 mb-4">Change Password</h3>
        {ok ? (
          <div data-testid="change-password-success" className="font-mono-tight text-sm text-[#039855]">Password updated.</div>
        ) : (
          <div className="space-y-3">
            <input
              data-testid="cp-current"
              type="password" placeholder="Current password"
              className="evcl-input"
              value={current} onChange={(e) => setCurrent(e.target.value)}
            />
            <input
              data-testid="cp-new"
              type="password" placeholder="New password (min 8)"
              className="evcl-input"
              value={next} onChange={(e) => setNext(e.target.value)}
            />
            {err && <div data-testid="cp-error" className="text-[#D92D20] font-mono-tight text-xs">{err}</div>}
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-secondary" onClick={onClose}>[ Cancel ]</button>
              <button data-testid="cp-submit" className="btn-primary" onClick={submit}>[ Update ]</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AppShell() {
  const { user, logout } = useAuth();
  const [tab, setTab] = React.useState("dashboard");
  const [reference, setReference] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [proposalRfp, setProposalRfp] = React.useState(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [showCP, setShowCP] = React.useState(false);

  React.useEffect(() => {
    if (!user) return;
    fetchReference().then(setReference).catch(() => setReference({}));
  }, [user]);

  if (user === null) {
    return (
      <div data-testid="auth-loading" className="min-h-screen flex items-center justify-center font-mono-tight text-sm text-[#666]">
        Loading session…
      </div>
    );
  }
  if (user === false) return <LoginPage />;

  const visibleTabs = BASE_TABS.filter((t) => !t.roles || t.roles.includes(user.role));
  const currentTabAllowed = visibleTabs.some((t) => t.key === tab)
    || tab === "proposal" || tab === "form";

  // If somehow on a role-restricted tab (viewer landing on form/admin), bounce to dashboard.
  const effectiveTab = (tab === "form" && !canEdit(user))
    || (tab === "admin" && !canAdmin(user))
    ? "dashboard"
    : (currentTabAllowed ? tab : "dashboard");

  const startNew = () => { setEditing(null); setTab("form"); };
  const startEdit = (rfp) => { setEditing(rfp); setTab("form"); };
  const startProposal = (rfp) => { setProposalRfp(rfp); setTab("proposal"); };
  const handleSaved = () => { setRefreshKey((k) => k + 1); setEditing(null); setTab("list"); };
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this RFP permanently?")) return;
    const { deleteRfp } = await import("@/lib/apiClient");
    await deleteRfp(id);
    setEditing(null);
    setRefreshKey((k) => k + 1);
    setTab("list");
  };

  return (
    <div className="App">
      <header className="border-b border-[#DCDCCF] bg-[#F4F4F0]">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 pt-10 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-5">
              <img
                src="/evolvebpm-logo.png"
                alt="EvolveBPM"
                data-testid="app-logo"
                className="h-14 md:h-16 w-auto mt-1"
              />
              <div>
                <div className="font-label">EVCL · Operations</div>
                <h1 className="font-serif-display text-5xl md:text-6xl italic mt-1">
                  RFP Master <span className="not-italic">Tracking</span>
                </h1>
                <div className="font-mono-tight text-xs text-[#666] mt-2">
                  A single source of truth for lead generation campaign requests · auto-computed universe & lead economics.
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-3">
              <div data-testid="user-chip" className="flex items-center gap-3 font-mono-tight text-xs">
                <span className="uppercase text-[#666]">{user.role}</span>
                <span>·</span>
                <span data-testid="user-email">{user.email}</span>
                <button
                  data-testid="change-password-btn"
                  className="btn-secondary"
                  style={{ padding: "0.3rem 0.6rem", fontSize: "0.6rem" }}
                  onClick={() => setShowCP(true)}
                >
                  <KeyRound size={11} strokeWidth={1.5} className="inline mr-1" />
                  Change PW
                </button>
                <button
                  data-testid="logout-btn"
                  className="btn-secondary"
                  style={{ padding: "0.3rem 0.6rem", fontSize: "0.6rem" }}
                  onClick={logout}
                >
                  <LogOut size={11} strokeWidth={1.5} className="inline mr-1" />
                  Logout
                </button>
              </div>
              <div data-testid="tab-nav" className="flex">
                {visibleTabs.map((t) => (
                  <button
                    key={t.key}
                    data-testid={`tab-${t.key}`}
                    className={`tab-btn ${effectiveTab === t.key ? "active" : ""}`}
                    onClick={() => { setTab(t.key); if (t.key !== "form") setEditing(null); }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {user.must_change_password && (
            <div
              data-testid="must-change-pw-banner"
              className="mt-4 border-l-4 border-[#D92D20] bg-[#FEF3F2] px-4 py-2 font-mono-tight text-xs"
            >
              You are using a temporary password. Please <button className="underline text-[#0A0A0A]" onClick={() => setShowCP(true)}>change it now</button>.
            </div>
          )}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 md:px-8 py-10">
        {effectiveTab === "dashboard" && <Dashboard refreshKey={refreshKey} />}
        {effectiveTab === "form" && canEdit(user) && (
          <RFPForm
            reference={reference}
            initialRfp={editing}
            onSaved={handleSaved}
            onCancel={editing ? () => { setEditing(null); setTab("list"); } : null}
            onDelete={handleDelete}
          />
        )}
        {effectiveTab === "list" && (
          <RFPList
            onNew={canEdit(user) ? startNew : null}
            onEdit={canEdit(user) ? startEdit : null}
            onProposal={startProposal}
            onDelete={canEdit(user) ? handleDelete : null}
            refreshKey={refreshKey}
          />
        )}
        {effectiveTab === "proposal" && proposalRfp && (
          <Proposal
            rfp={proposalRfp}
            reference={reference}
            onBack={() => { setProposalRfp(null); setTab("list"); }}
          />
        )}
        {effectiveTab === "admin" && canAdmin(user) && (
          <Admin onSaved={() => fetchReference().then(setReference).catch(() => {})} />
        )}
      </main>

      <footer className="border-t border-[#DCDCCF] mt-16">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-6 flex items-center justify-between font-mono-tight text-xs text-[#666]">
          <div className="flex items-center gap-3">
            <img src="/evolvebpm-logo.png" alt="EvolveBPM" className="h-6 w-auto opacity-70" />
            <span>EvolveBPM · Decoding the sales ecosystem</span>
          </div>
          <div>v1.0 · {new Date().getFullYear()}</div>
        </div>
      </footer>
      {showCP && <ChangePasswordModal onClose={() => setShowCP(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
