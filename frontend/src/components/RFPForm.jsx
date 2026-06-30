import React from "react";
import MultiSelect from "./MultiSelect";
import { LEAD_TYPES, buildClientIds, emptyRFP, fmtNum, fmtCurrency, useDebounce } from "../lib/rfpUtils";
import { previewCompute, createRfp, updateRfp } from "../lib/apiClient";
import { Save, RotateCcw, Trash2 } from "lucide-react";

const CLIENT_IDS = buildClientIds();

const Field = ({ label, children, span = 1 }) => {
  const spanClass = span === 3 ? "md:col-span-3" : span === 2 ? "md:col-span-2" : "";
  return (
    <div className={spanClass}>
      <label className="font-label block mb-2">{label}</label>
      {children}
    </div>
  );
};

export default function RFPForm({ reference, initialRfp = null, onSaved, onCancel, onDelete }) {
  const [rfp, setRfp] = React.useState(initialRfp || emptyRFP());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const debounced = useDebounce(rfp, 300);

  // Auto-compute Section 2 + Section 3 via backend preview
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await previewCompute(debounced);
        if (!active) return;
        setRfp((prev) => ({
          ...prev,
          section2: res.section2,
          section3: res.section3,
        }));
      } catch (e) {
        // ignore preview errors silently
      }
    })();
    return () => { active = false; };
    // We trigger when inputs that affect computation change; debounce reduces churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(debounced.section1),
    JSON.stringify(debounced.section3.rows.map(r => ({ t: r.lead_type, c: r.cpc, l: r.lead_counts }))),
  ]);

  const updateS1 = (key, value) =>
    setRfp((p) => ({ ...p, section1: { ...p.section1, [key]: value } }));
  const updateRunDate = (k, v) =>
    setRfp((p) => ({
      ...p, section1: { ...p.section1, campaign_run_date: { ...p.section1.campaign_run_date, [k]: v } },
    }));
  const updateCampType = (k, v) =>
    setRfp((p) => ({
      ...p, section1: { ...p.section1, campaign_type_config: { ...p.section1.campaign_type_config, [k]: v } },
    }));
  const updateS4 = (k, v) =>
    setRfp((p) => ({ ...p, section4: { ...p.section4, [k]: v } }));
  const updateRow = (idx, k, v) =>
    setRfp((p) => {
      const rows = [...p.section3.rows];
      rows[idx] = { ...rows[idx], [k]: Number(v) || 0 };
      return { ...p, section3: { ...p.section3, rows } };
    });

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      const saved = initialRfp
        ? await updateRfp(initialRfp.id, rfp)
        : await createRfp(rfp);
      onSaved && onSaved(saved);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => setRfp(emptyRFP());

  const s1 = rfp.section1;
  const s2 = rfp.section2;
  const s3 = rfp.section3;
  const s4 = rfp.section4;
  const ref = reference || {};

  return (
    <div data-testid="rfp-form" className="space-y-2">
      {/* ============== HEADER STRIP ============== */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6 border-b-2 border-[#0A0A0A]">
        <div>
          <div className="font-label">{initialRfp ? "Editing RFP" : "New RFP Entry"}</div>
          <h2 className="font-serif-display text-4xl md:text-5xl mt-1">RFP Master Tracking</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          {initialRfp && (
            <button
              data-testid="rfp-delete-button"
              className="btn-danger"
              onClick={() => onDelete && onDelete(initialRfp.id)}
            >
              <Trash2 size={14} strokeWidth={1.5} className="inline mr-1" /> Delete
            </button>
          )}
          <button data-testid="rfp-reset-button" className="btn-secondary" onClick={reset}>
            <RotateCcw size={14} strokeWidth={1.5} className="inline mr-1" /> Reset
          </button>
          {onCancel && (
            <button data-testid="rfp-cancel-button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            data-testid="rfp-save-button"
            className="btn-primary"
            disabled={saving}
            onClick={handleSave}
          >
            <Save size={14} strokeWidth={1.5} className="inline mr-1" />
            {saving ? "Saving…" : initialRfp ? "[ Update RFP ]" : "[ Save RFP ]"}
          </button>
        </div>
      </div>
      {error && (
        <div data-testid="rfp-form-error" className="text-[#D92D20] font-mono-tight text-sm py-2">
          {error}
        </div>
      )}

      {/* ============== SECTION 1: RFP DISCOVERY ============== */}
      <Section title="Section 01 — RFP Discovery">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-5">
          <Field label="RFP Master Tracking Sheet Reference">
            <input
              data-testid="input-rfp-master-sheet"
              className="evcl-input"
              value={s1.rfp_master_tracking_sheet}
              onChange={(e) => updateS1("rfp_master_tracking_sheet", e.target.value)}
              placeholder="Tracker reference…"
            />
          </Field>
          <Field label="Date of RFP">
            <input
              type="date"
              data-testid="input-date-of-rfp"
              className="evcl-input"
              value={s1.date_of_rfp || ""}
              onChange={(e) => updateS1("date_of_rfp", e.target.value)}
            />
          </Field>
          <Field label="Client ID (EVCL001 – EVCL100)">
            <select
              data-testid="input-client-id"
              className="evcl-input"
              value={s1.client_id || ""}
              onChange={(e) => updateS1("client_id", e.target.value)}
            >
              <option value="">— Select Client ID —</option>
              {CLIENT_IDS.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </Field>

          <Field label="Campaign Start Date">
            <input
              type="date"
              data-testid="input-campaign-start"
              className="evcl-input"
              value={s1.campaign_run_date.start_date || ""}
              onChange={(e) => updateRunDate("start_date", e.target.value)}
            />
          </Field>
          <Field label="Campaign End Date">
            <input
              type="date"
              data-testid="input-campaign-end"
              className="evcl-input"
              value={s1.campaign_run_date.end_date || ""}
              onChange={(e) => updateRunDate("end_date", e.target.value)}
            />
          </Field>
          <Field label="Contacts per Company">
            <input
              type="number"
              min="1"
              data-testid="input-contacts-per-company"
              className="evcl-input"
              value={s1.contacts_per_company}
              onChange={(e) => updateS1("contacts_per_company", Number(e.target.value) || 1)}
            />
          </Field>

          <Field label="Campaign Name">
            <input
              data-testid="input-campaign-name"
              className="evcl-input"
              value={s1.campaign_name}
              onChange={(e) => updateS1("campaign_name", e.target.value)}
              placeholder="e.g. Q1 ABM EU Push"
            />
          </Field>
          <Field label="Campaign ID">
            <input
              data-testid="input-campaign-id"
              className="evcl-input"
              value={s1.campaign_id}
              onChange={(e) => updateS1("campaign_id", e.target.value)}
              placeholder="e.g. CMP-2026-001"
            />
          </Field>
          <Field label="End Client Name">
            <input
              data-testid="input-end-client-name"
              className="evcl-input"
              value={s1.end_client_name}
              onChange={(e) => updateS1("end_client_name", e.target.value)}
              placeholder="Brand / advertiser"
            />
          </Field>

          <div className="md:col-span-3"><hr className="border-[#DCDCCF]" /></div>

          <Field label="Target Geography (LinkedIn)">
            <MultiSelect id="geo" options={ref.geographies || []} value={s1.target_geography} onChange={(v) => updateS1("target_geography", v)} placeholder="Continents, regions, countries…" />
          </Field>
          <Field label="Target Industries (LinkedIn)">
            <MultiSelect id="industries" options={ref.industries || []} value={s1.target_industries} onChange={(v) => updateS1("target_industries", v)} placeholder="Select industries…" />
          </Field>
          <Field label="Target Job Functions">
            <MultiSelect id="jobfunc" options={ref.job_functions || []} value={s1.target_job_functions} onChange={(v) => updateS1("target_job_functions", v)} placeholder="Select functions…" />
          </Field>

          <Field label="Revenue Size (LinkedIn bands)">
            <MultiSelect id="revenue" options={ref.revenue_sizes || []} value={s1.revenue_size} onChange={(v) => updateS1("revenue_size", v)} placeholder="Revenue bands…" />
          </Field>
          <Field label="Employee Size (LinkedIn bands)">
            <MultiSelect id="employee" options={ref.employee_sizes || []} value={s1.employee_size} onChange={(v) => updateS1("employee_size", v)} placeholder="Employee bands…" />
          </Field>
          <Field label="Target Job Titles / Seniority">
            <MultiSelect id="titles" options={ref.job_titles || []} value={s1.target_job_titles} onChange={(v) => updateS1("target_job_titles", v)} placeholder="Seniority levels…" />
          </Field>

          <Field label="Exclusions (Company / Industry / Functions / Titles)" span={3}>
            <textarea
              data-testid="input-exclusions"
              className="evcl-input"
              rows={3}
              value={s1.exclusions}
              onChange={(e) => updateS1("exclusions", e.target.value)}
              placeholder="Comma-separated exclusions…"
            />
          </Field>

          <Field label="Suppression File (Company Names / Email IDs)" span={3}>
            <textarea
              data-testid="input-suppression"
              className="evcl-input"
              rows={3}
              value={s1.suppression_file}
              onChange={(e) => updateS1("suppression_file", e.target.value)}
              placeholder="Paste suppression list — names, emails…"
            />
          </Field>

          <div className="md:col-span-3"><hr className="border-[#DCDCCF]" /></div>

          <Field label="Type of Campaign">
            <select
              data-testid="input-campaign-type"
              className="evcl-input"
              value={s1.campaign_type_config.type || ""}
              onChange={(e) => updateCampType("type", e.target.value)}
            >
              <option value="">— Select —</option>
              {(ref.campaign_types || []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Number of CQ">
            <input
              type="number" min="0"
              data-testid="input-num-cq"
              className="evcl-input"
              value={s1.campaign_type_config.num_cq}
              onChange={(e) => updateCampType("num_cq", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Number of QQ">
            <input
              type="number" min="0"
              data-testid="input-num-qq"
              className="evcl-input"
              value={s1.campaign_type_config.num_qq}
              onChange={(e) => updateCampType("num_qq", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Number of Touches">
            <input
              type="number" min="0"
              data-testid="input-num-touches"
              className="evcl-input"
              value={s1.campaign_type_config.num_touches}
              onChange={(e) => updateCampType("num_touches", Number(e.target.value) || 0)}
            />
          </Field>
        </div>
      </Section>

      {/* ============== SECTION 2: DATA UNIVERSE ============== */}
      <Section title="Section 02 — Data Universe Estimation">
        <div data-testid="data-universe-block" className="bg-[#0A0A0A] text-white px-8 py-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <div className="font-label text-white/60">Estimated Data Universe</div>
            <div className="font-serif-display italic text-white/70 text-base mt-3 max-w-md">
              Auto-computed from Target Geography × Industries × Revenue & Employee bands × Contacts per Company.
            </div>
          </div>
          <div data-testid="data-universe-value" className="kpi-num text-white">
            {fmtNum(s2.data_universe)}
          </div>
        </div>
      </Section>

      {/* ============== SECTION 3: LEAD COMPUTATION ============== */}
      <Section title="Section 03 — Computation of Leads Quantity to be Delivered">
        <div className="overflow-x-auto">
          <table className="evcl-table" data-testid="lead-computation-table">
            <thead>
              <tr>
                <th>Lead Type</th>
                <th className="num">CPC ($)</th>
                <th className="num">Lead Counts</th>
                <th className="num">CPL ($) · auto</th>
                <th className="num">Total Cost · auto</th>
              </tr>
            </thead>
            <tbody>
              {s3.rows.map((r, idx) => (
                <tr key={r.lead_type} data-testid={`lead-row-${r.lead_type}`}>
                  <td className="font-mono-tight uppercase">{r.lead_type}</td>
                  <td className="num">
                    <input
                      type="number" min="0" step="0.01"
                      data-testid={`input-cpc-${r.lead_type}`}
                      className="evcl-input text-right"
                      value={r.cpc}
                      onChange={(e) => updateRow(idx, "cpc", e.target.value)}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number" min="0"
                      data-testid={`input-leadcount-${r.lead_type}`}
                      className="evcl-input text-right"
                      value={r.lead_counts}
                      onChange={(e) => updateRow(idx, "lead_counts", e.target.value)}
                    />
                  </td>
                  <td className="num" data-testid={`cell-cpl-${r.lead_type}`}>{fmtCurrency(r.cpl)}</td>
                  <td className="num" data-testid={`cell-total-${r.lead_type}`}>{fmtCurrency(r.total_cost)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[#0A0A0A] font-semibold">
                <td className="font-label">Totals</td>
                <td></td>
                <td className="num" data-testid="grand-total-leads">{fmtNum(s3.grand_total_leads)}</td>
                <td className="num" data-testid="blended-cpl">{fmtCurrency(s3.blended_cpl)} <span className="text-[#666] font-label ml-1">blended</span></td>
                <td className="num" data-testid="grand-total-cost">{fmtCurrency(s3.grand_total_cost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="font-mono-tight text-xs text-[#666] mt-3">
          CPL is auto-derived: CPL = CPC × lead-type complexity multiplier. Total = CPL × Lead Counts.
        </div>
      </Section>

      {/* ============== SECTION 4: RFP STATUS ============== */}
      <Section title="Section 04 — RFP Status">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-5">
          <Field label="RFP Submitted Date">
            <input
              type="date"
              data-testid="input-rfp-submitted-date"
              className="evcl-input"
              value={s4.rfp_submitted_date || ""}
              onChange={(e) => updateS4("rfp_submitted_date", e.target.value)}
            />
          </Field>
          <Field label="RFP Converted">
            <div className="flex gap-2 mt-1">
              {["Y", "N"].map((opt) => (
                <button
                  type="button"
                  key={opt}
                  data-testid={`toggle-converted-${opt}`}
                  className={`btn-secondary flex-1 ${s4.rfp_converted === opt ? "bg-[#0A0A0A] text-white" : ""}`}
                  onClick={() => updateS4("rfp_converted", opt)}
                >
                  {opt === "Y" ? "Yes · Converted" : "No · Pending"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Volumes Assigned">
            <input
              type="number" min="0"
              data-testid="input-volumes-assigned"
              className="evcl-input"
              value={s4.volumes_assigned}
              onChange={(e) => updateS4("volumes_assigned", Number(e.target.value) || 0)}
            />
          </Field>
        </div>
      </Section>

      <div className="pt-6 flex justify-end gap-3">
        <button
          data-testid="rfp-save-button-bottom"
          className="btn-primary"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "Saving…" : initialRfp ? "[ Update RFP ]" : "[ Save RFP ]"}
        </button>
      </div>
    </div>
  );
}

const Section = ({ title, children }) => (
  <section className="section-rule">
    <h3 className="font-label mb-6">{title}</h3>
    {children}
  </section>
);
