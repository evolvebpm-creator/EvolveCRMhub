import React from "react";
import { fetchFormula, updateFormula, resetFormula } from "../lib/apiClient";
import { RotateCcw, Save } from "lucide-react";

const LEAD_TYPES_ORDER = [
  "MQL", "HQL", "BANT - DIGITAL", "BANT - TELE", "BANT +",
  "APPOINTMENT SET-UP",
  "WEBINAR REGISTRATIONS", "WEBINAR ATTENDEES",
  "LIVE EVENT REGISTRATIONS", "LIVE EVENT ATTENDEES",
];

const clone = (o) => JSON.parse(JSON.stringify(o));

export default function Admin({ onSaved }) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [config, setConfig] = React.useState(null);
  const [defaults, setDefaults] = React.useState(null);
  const [status, setStatus] = React.useState("");

  const load = React.useCallback(() => {
    setLoading(true);
    fetchFormula()
      .then((r) => { setConfig(clone(r.current)); setDefaults(r.defaults); })
      .catch(() => setStatus("Failed to load configuration"))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const setRate = (source, leadType, val) => {
    setConfig((c) => {
      const next = clone(c);
      next.conversion_rates[source] = next.conversion_rates[source] || {};
      next.conversion_rates[source][leadType] = Number(val);
      return next;
    });
  };
  const setBucketVal = (key, bucket, val, isPct) => {
    setConfig((c) => {
      const next = clone(c);
      const n = Number(val);
      next[key][bucket] = isPct ? n / 100 : n;
      return next;
    });
  };
  const setTv = (val) => setConfig((c) => ({ ...c, tv_reduction: Number(val) / 100 }));

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setStatus("");
    try {
      await updateFormula(config);
      setStatus("Saved · new formula applied to all future calculations.");
      if (onSaved) onSaved();
    } catch (e) {
      setStatus("Save failed — please retry.");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset all conversion rates and modifiers to factory defaults?")) return;
    setSaving(true);
    setStatus("");
    try {
      const r = await resetFormula();
      setConfig(clone(r.current));
      setStatus("Restored to factory defaults.");
      if (onSaved) onSaved();
    } catch (e) {
      setStatus("Reset failed.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return <div data-testid="admin-loading" className="font-mono-tight text-sm text-[#666]">Loading configuration…</div>;
  }

  const sources = Object.keys(config.conversion_rates || {});
  const cpcKeys = Object.keys(config.cpc_divisors || {}).sort((a, b) => Number(a) - Number(b));
  const cqKeys = Object.keys(config.cq_reductions || {}).sort((a, b) => Number(a) - Number(b));
  const qqKeys = Object.keys(config.qq_reductions || {}).sort((a, b) => Number(a) - Number(b));

  return (
    <div data-testid="admin-panel" className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6 border-b-2 border-[#0A0A0A]">
        <div>
          <div className="font-label">Formula Configuration</div>
          <h2 className="font-serif-display text-4xl md:text-5xl mt-1">Conversion Matrix & Modifiers</h2>
          <div className="font-mono-tight text-xs text-[#666] mt-2 max-w-3xl">
            Live-editable rates that drive Section-3 lead volumes. Changes apply immediately to preview, save, and export. All numbers below are shown as percentages (%).
          </div>
        </div>
        <div className="flex gap-3">
          <button
            data-testid="admin-reset-button"
            className="btn-secondary"
            onClick={reset}
            disabled={saving}
          >
            <RotateCcw size={14} strokeWidth={1.5} className="inline mr-1" />
            [ Reset to Defaults ]
          </button>
          <button
            data-testid="admin-save-button"
            className="btn-primary"
            onClick={save}
            disabled={saving}
          >
            <Save size={14} strokeWidth={1.5} className="inline mr-1" />
            {saving ? "[ Saving… ]" : "[ Save Changes ]"}
          </button>
        </div>
      </div>

      {status && (
        <div data-testid="admin-status" className="font-mono-tight text-xs bg-[#F0F0EE] border-l-2 border-[#0A0A0A] px-3 py-2">
          {status}
        </div>
      )}

      {/* Conversion Rates matrix */}
      <section className="panel p-6 md:p-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-label">Conversion Rates · % of Data Universe</div>
            <div className="font-mono-tight text-xs text-[#666] mt-1">
              Rows = Lead Types · Columns = Data Sources. Webinar / Live-event rows are source-independent (all sources share the same value).
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="evcl-table" data-testid="admin-conversion-table">
            <thead>
              <tr>
                <th>Lead Type</th>
                {sources.map((src) => (
                  <th key={src} className="num">{src}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEAD_TYPES_ORDER.map((lt) => (
                <tr key={lt}>
                  <td className="font-mono-tight uppercase">{lt}</td>
                  {sources.map((src) => (
                    <td key={src} className="num" style={{ padding: "0.4rem" }}>
                      <input
                        type="number" step="0.5" min="0" max="100"
                        data-testid={`admin-rate-${src}-${lt}`}
                        className="evcl-input text-right"
                        style={{ width: "90px" }}
                        value={((config.conversion_rates[src] || {})[lt] ?? 0)}
                        onChange={(e) => setRate(src, lt, e.target.value)}
                      />
                      <span className="font-mono-tight text-xs text-[#666] ml-1">%</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CPC divisors */}
        <section className="panel p-6 md:p-8">
          <div className="font-label mb-2">CPC Divisors · Contacts per Company</div>
          <div className="font-mono-tight text-xs text-[#666] mb-4">
            After the base formula, leads are divided by this value based on how many contacts per company are targeted. Higher divisor = fewer leads.
          </div>
          <table className="evcl-table" data-testid="admin-cpc-table">
            <thead>
              <tr>
                <th>CPC (Contacts / Company)</th>
                <th className="num">Divisor</th>
              </tr>
            </thead>
            <tbody>
              {cpcKeys.map((k) => (
                <tr key={k}>
                  <td className="font-mono-tight">{k}</td>
                  <td className="num" style={{ padding: "0.4rem" }}>
                    <input
                      type="number" step="0.05" min="0.01"
                      data-testid={`admin-cpc-${k}`}
                      className="evcl-input text-right"
                      style={{ width: "110px" }}
                      value={config.cpc_divisors[k]}
                      onChange={(e) => setBucketVal("cpc_divisors", k, e.target.value, false)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* TV reduction */}
        <section className="panel p-6 md:p-8">
          <div className="font-label mb-2">Tele-Verification (TV) Reduction</div>
          <div className="font-mono-tight text-xs text-[#666] mb-4">
            Applied to the <strong>MQL</strong> row only when the &quot;With TV&quot; toggle is on in Section 1.
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number" step="1" min="0" max="100"
              data-testid="admin-tv-reduction"
              className="evcl-input text-right"
              style={{ width: "120px", fontSize: "1.4rem" }}
              value={Math.round((config.tv_reduction || 0) * 100)}
              onChange={(e) => setTv(e.target.value)}
            />
            <span className="font-mono-tight text-sm text-[#666]">% reduction on MQL</span>
          </div>
        </section>

        {/* CQ reductions */}
        <section className="panel p-6 md:p-8">
          <div className="font-label mb-2">Custom Questions (CQ) · MQL Reductions</div>
          <div className="font-mono-tight text-xs text-[#666] mb-4">
            Number of custom questions asked reduces MQL delivery by the % below.
          </div>
          <table className="evcl-table" data-testid="admin-cq-table">
            <thead>
              <tr>
                <th># of CQ</th>
                <th className="num">% Reduction (MQL)</th>
              </tr>
            </thead>
            <tbody>
              {cqKeys.map((k) => (
                <tr key={k}>
                  <td className="font-mono-tight">{k}</td>
                  <td className="num" style={{ padding: "0.4rem" }}>
                    <input
                      type="number" step="1" min="0" max="100"
                      data-testid={`admin-cq-${k}`}
                      className="evcl-input text-right"
                      style={{ width: "110px" }}
                      value={Math.round((config.cq_reductions[k] || 0) * 100)}
                      onChange={(e) => setBucketVal("cq_reductions", k, e.target.value, true)}
                    />
                    <span className="font-mono-tight text-xs text-[#666] ml-1">%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* QQ reductions */}
        <section className="panel p-6 md:p-8">
          <div className="font-label mb-2">Qualifying Questions (QQ) · MQL Reductions</div>
          <div className="font-mono-tight text-xs text-[#666] mb-4">
            Number of qualifying questions asked reduces MQL delivery by the % below.
          </div>
          <table className="evcl-table" data-testid="admin-qq-table">
            <thead>
              <tr>
                <th># of QQ</th>
                <th className="num">% Reduction (MQL)</th>
              </tr>
            </thead>
            <tbody>
              {qqKeys.map((k) => (
                <tr key={k}>
                  <td className="font-mono-tight">{k}</td>
                  <td className="num" style={{ padding: "0.4rem" }}>
                    <input
                      type="number" step="1" min="0" max="100"
                      data-testid={`admin-qq-${k}`}
                      className="evcl-input text-right"
                      style={{ width: "110px" }}
                      value={Math.round((config.qq_reductions[k] || 0) * 100)}
                      onChange={(e) => setBucketVal("qq_reductions", k, e.target.value, true)}
                    />
                    <span className="font-mono-tight text-xs text-[#666] ml-1">%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
