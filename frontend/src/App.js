import React from "react";
import "@/App.css";
import { fetchReference } from "@/lib/apiClient";
import Dashboard from "@/components/Dashboard";
import RFPForm from "@/components/RFPForm";
import RFPList from "@/components/RFPList";

const TABS = [
  { key: "dashboard", label: "[ 01 / Dashboard ]" },
  { key: "form", label: "[ 02 / RFP Tracker ]" },
  { key: "list", label: "[ 03 / All RFPs ]" },
];

function App() {
  const [tab, setTab] = React.useState("dashboard");
  const [reference, setReference] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    fetchReference().then(setReference).catch(() => setReference({}));
  }, []);

  const startNew = () => {
    setEditing(null);
    setTab("form");
  };

  const startEdit = (rfp) => {
    setEditing(rfp);
    setTab("form");
  };

  const handleSaved = () => {
    setRefreshKey((k) => k + 1);
    setEditing(null);
    setTab("list");
  };

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
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-label">EVCL · Operations</div>
              <h1 className="font-serif-display text-5xl md:text-6xl italic mt-1">
                RFP Master <span className="not-italic">Tracking</span>
              </h1>
              <div className="font-mono-tight text-xs text-[#666] mt-2">
                A single source of truth for lead generation campaign requests · auto-computed universe & lead economics.
              </div>
            </div>
            <div data-testid="tab-nav" className="flex">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  data-testid={`tab-${t.key}`}
                  className={`tab-btn ${tab === t.key ? "active" : ""}`}
                  onClick={() => { setTab(t.key); if (t.key !== "form") setEditing(null); }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 md:px-8 py-10">
        {tab === "dashboard" && <Dashboard refreshKey={refreshKey} />}
        {tab === "form" && (
          <RFPForm
            reference={reference}
            initialRfp={editing}
            onSaved={handleSaved}
            onCancel={editing ? () => { setEditing(null); setTab("list"); } : null}
            onDelete={handleDelete}
          />
        )}
        {tab === "list" && (
          <RFPList onNew={startNew} onEdit={startEdit} refreshKey={refreshKey} />
        )}
      </main>

      <footer className="border-t border-[#DCDCCF] mt-16">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-6 flex justify-between font-mono-tight text-xs text-[#666]">
          <div>EVCL · RFP Master Tracking · Internal Ops Console</div>
          <div>v1.0 · {new Date().getFullYear()}</div>
        </div>
      </footer>
    </div>
  );
}

export default App;
