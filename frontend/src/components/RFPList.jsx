import React from "react";
import { fetchRfps, deleteRfp } from "../lib/apiClient";
import { fmtNum, fmtCurrency } from "../lib/rfpUtils";
import { Plus, Pencil, Trash2, Search } from "lucide-react";

export default function RFPList({ onNew, onEdit, refreshKey }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState({ converted: "", search: "" });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter.converted) params.converted = filter.converted;
      if (filter.search) params.search = filter.search;
      const data = await fetchRfps(params);
      setRows(data);
    } finally { setLoading(false); }
  }, [filter]);

  React.useEffect(() => { load(); }, [load, refreshKey]);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this RFP permanently?")) return;
    await deleteRfp(id);
    load();
  };

  return (
    <div data-testid="rfp-list" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6 border-b-2 border-[#0A0A0A]">
        <div>
          <div className="font-label">Registry</div>
          <h2 className="font-serif-display text-4xl md:text-5xl mt-1">All RFPs</h2>
        </div>
        <button data-testid="new-rfp-button" className="btn-primary" onClick={onNew}>
          <Plus size={14} strokeWidth={1.5} className="inline mr-1" /> [ New RFP ]
        </button>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="font-label block mb-2">Search</label>
          <div className="relative">
            <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" />
            <input
              data-testid="search-input"
              className="evcl-input pl-9"
              placeholder="Campaign, client id, end client…"
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
        </div>
        <div>
          <label className="font-label block mb-2">Status</label>
          <select
            data-testid="status-filter"
            className="evcl-input"
            value={filter.converted}
            onChange={(e) => setFilter((f) => ({ ...f, converted: e.target.value }))}
          >
            <option value="">All</option>
            <option value="Y">Converted</option>
            <option value="N">Pending</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="evcl-table" data-testid="rfp-table">
          <thead>
            <tr>
              <th>Client ID</th>
              <th>Campaign</th>
              <th>End Client</th>
              <th className="num">Universe</th>
              <th className="num">Total Leads</th>
              <th className="num">Total Cost</th>
              <th>Status</th>
              <th>Submitted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="text-center py-6 text-[#666] font-mono-tight text-sm">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="text-center py-10 text-[#666] font-mono-tight text-sm" data-testid="empty-rows">
                No RFPs yet — create the first one.
              </td></tr>
            )}
            {rows.map((r) => {
              const s1 = r.section1 || {};
              const s2 = r.section2 || {};
              const s3 = r.section3 || {};
              const s4 = r.section4 || {};
              return (
                <tr key={r.id} data-testid={`rfp-row-${r.id}`}>
                  <td className="font-mono-tight">{s1.client_id || "—"}</td>
                  <td>
                    <div className="font-mono-tight">{s1.campaign_name || "Untitled"}</div>
                    <div className="text-xs text-[#666] font-mono-tight">{s1.campaign_id || ""}</div>
                  </td>
                  <td className="font-mono-tight">{s1.end_client_name || "—"}</td>
                  <td className="num">{fmtNum(s2.data_universe)}</td>
                  <td className="num">{fmtNum(s3.grand_total_leads)}</td>
                  <td className="num">{fmtCurrency(s3.grand_total_cost)}</td>
                  <td>
                    <span className={`chip ${s4.rfp_converted === "Y" ? "" : "bg-transparent text-[#0A0A0A] border border-[#0A0A0A]"}`}>
                      {s4.rfp_converted === "Y" ? "CONVERTED" : "PENDING"}
                    </span>
                  </td>
                  <td className="font-mono-tight text-sm">{s4.rfp_submitted_date || "—"}</td>
                  <td>
                    <div className="flex gap-2 justify-end">
                      <button
                        data-testid={`edit-${r.id}`}
                        className="btn-secondary"
                        onClick={() => onEdit(r)}
                      ><Pencil size={12} strokeWidth={1.5} /></button>
                      <button
                        data-testid={`delete-${r.id}`}
                        className="btn-danger"
                        onClick={() => handleDelete(r.id)}
                      ><Trash2 size={12} strokeWidth={1.5} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
