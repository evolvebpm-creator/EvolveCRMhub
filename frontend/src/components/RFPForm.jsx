import React from "react";
import MultiSelect from "./MultiSelect";
import { LEAD_TYPES, buildClientIds, emptyRFP, fmtNum, fmtCurrency, useDebounce } from "../lib/rfpUtils";
import { previewCompute, createRfp, updateRfp, fetchNextRef } from "../lib/apiClient";
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
  const [nextSeq, setNextSeq] = React.useState(null); // for NEW RFPs only

  const debounced = useDebounce(rfp, 300);

  // Fetch next sequential number ONCE for new-RFP flow so we can live-preview the ref.
  React.useEffect(() => {
    if (initialRfp) return;
    fetchNextRef().then((r) => setNextSeq(r.seq)).catch(() => setNextSeq(null));
  }, [initialRfp]);

  // Compute the Master Tracking Sheet Ref (live preview) — EV_Q_{NNN}_{YYYYMMDD}.
  const computeRef = React.useCallback(() => {
    const existing = rfp.section1.rfp_master_tracking_sheet || "";
    // Extract seq from existing ref if editing, else use nextSeq.
    let seq = null;
    const m = existing.match(/^EV_Q_(\d{3,})/);
    if (m) seq = parseInt(m[1], 10);
    if (seq == null) seq = nextSeq;
    if (seq == null) return "EV_Q_… (loading)";
    const seqStr = String(seq).padStart(3, "0");
    const d = (rfp.section1.date_of_rfp || "").replace(/-/g, "");
    const dateStr = d || new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `EV_Q_${seqStr}_${dateStr}`;
  }, [rfp.section1.rfp_master_tracking_sheet, rfp.section1.date_of_rfp, nextSeq]);

  const previewRef = computeRef();

  // Auto-compute Section 2 + Section 3 via backend preview
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await previewCompute(debounced);
        if (!active) return;
        setRfp((prev) => ({
          ...prev,
          // If user has explicitly entered a Data Universe (> 0), keep it; else accept auto-suggest.
          section2: (Number(prev.section2.data_universe) || 0) > 0
            ? prev.section2
            : res.section2,
          section3: {
            ...prev.section3,
            // Preserve user-editable fields; merge only auto-computed values per row
            rows: prev.section3.rows.map((row) => {
              const computed = res.section3.rows.find((c) => c.lead_type === row.lead_type);
              if (!computed) return row;
              return {
                ...row,
                lead_counts: computed.lead_counts,
                total_cost: computed.total_cost,
              };
            }),
            grand_total_leads: res.section3.grand_total_leads,
            grand_total_cost: res.section3.grand_total_cost,
            blended_cpl: res.section3.blended_cpl,
          },
        }));
      } catch (e) {
        // ignore preview errors silently
      }
    })();
    return () => { active = false; };
    // We trigger when inputs that affect computation change; debounce reduces churn.
  }, [
    JSON.stringify(debounced.section1),
    debounced.section2.data_universe,
    JSON.stringify(debounced.section2.universe_by_country || {}),
    debounced.section3.data_source,
    JSON.stringify(debounced.section3.rows.map(r => ({ t: r.lead_type, c: r.cpl }))),
    JSON.stringify(debounced.section3.cpl_by_country || {}),
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
  const updateS3 = (k, v) =>
    setRfp((p) => ({ ...p, section3: { ...p.section3, [k]: v } }));
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

  // Derive the set of "active" lead types based on Campaign Types selected in Section 1.
  const campaignTypesSelected = s1.campaign_type_config.types || [];
  const targetedSet = new Set();
  const mapCampaign = (t) => {
    if (["MQL", "MQL with CQ", "MQL with QQ", "Single touch", "Double touch", "Multi touch"].includes(t)) {
      return ["MQL"];
    }
    if (t === "HQL") return ["HQL"];
    if (t === "BANT - Digital") return ["BANT - DIGITAL"];
    if (t === "BANT - Tele") return ["BANT - TELE"];
    if (t === "BANT +") return ["BANT +"];
    if (t === "BANT") return ["BANT - DIGITAL", "BANT - TELE", "BANT +"];
    if (t === "Appointment Set-up" || t === "Appointment-setup") return ["APPOINTMENT SET-UP"];
    if (t === "Webinar Registrations") return ["WEBINAR REGISTRATIONS"];
    if (t === "Webinar Attendees") return ["WEBINAR ATTENDEES"];
    if (t === "LIVE Event Registrations") return ["LIVE EVENT REGISTRATIONS"];
    if (t === "LIVE Event Attendees") return ["LIVE EVENT ATTENDEES"];
    return [];
  };
  campaignTypesSelected.forEach((t) => mapCampaign(t).forEach((lt) => targetedSet.add(lt)));

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

      {/* ============== SECTION 00: RFP SCOPE ============== */}
      <Section title="Section 00 — RFP Scope">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-5">
          <Field label="Scope Type">
            <div className="flex gap-2 mt-1">
              {["TAL", "Whitespace"].map((opt) => (
                <button
                  type="button"
                  key={opt}
                  data-testid={`toggle-scope-${opt.toLowerCase()}`}
                  className={`btn-secondary flex-1 ${
                    (s1.scope || {}).type === opt ? "bg-[#0A0A0A] text-white" : ""
                  }`}
                  onClick={() =>
                    setRfp((p) => ({
                      ...p,
                      section1: {
                        ...p.section1,
                        scope: { ...(p.section1.scope || {}), type: opt },
                      },
                    }))
                  }
                >
                  {opt}
                </button>
              ))}
            </div>
            <div className="font-mono-tight text-xs text-[#666] mt-2">
              TAL = Target Account List provided by the client · Whitespace = discover new accounts
            </div>
          </Field>

          {(s1.scope || {}).type === "TAL" && (
            <div className="md:col-span-2">
              <label className="font-label block mb-2">TAL Match Details</label>
              <table className="evcl-table" data-testid="tal-details-table">
                <thead>
                  <tr>
                    <th>Total TAL Count</th>
                    <th>With Valid Domains</th>
                    <th>TAL Match Count</th>
                    <th className="num">Match %</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <input
                        type="number" min="0"
                        data-testid="input-tal-total"
                        className="evcl-input"
                        value={(s1.scope?.tal || {}).total_count || 0}
                        onChange={(e) =>
                          setRfp((p) => ({
                            ...p,
                            section1: {
                              ...p.section1,
                              scope: {
                                ...(p.section1.scope || {}),
                                tal: {
                                  ...((p.section1.scope || {}).tal || {}),
                                  total_count: Number(e.target.value) || 0,
                                },
                              },
                            },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number" min="0"
                        data-testid="input-tal-valid"
                        className="evcl-input"
                        value={(s1.scope?.tal || {}).valid_domain_count || 0}
                        onChange={(e) =>
                          setRfp((p) => ({
                            ...p,
                            section1: {
                              ...p.section1,
                              scope: {
                                ...(p.section1.scope || {}),
                                tal: {
                                  ...((p.section1.scope || {}).tal || {}),
                                  valid_domain_count: Number(e.target.value) || 0,
                                },
                              },
                            },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number" min="0"
                        data-testid="input-tal-match"
                        className="evcl-input"
                        value={(s1.scope?.tal || {}).match_count || 0}
                        onChange={(e) =>
                          setRfp((p) => ({
                            ...p,
                            section1: {
                              ...p.section1,
                              scope: {
                                ...(p.section1.scope || {}),
                                tal: {
                                  ...((p.section1.scope || {}).tal || {}),
                                  match_count: Number(e.target.value) || 0,
                                },
                              },
                            },
                          }))
                        }
                      />
                    </td>
                    <td className="num font-mono-tight text-lg font-semibold" data-testid="cell-tal-match-pct">
                      {(() => {
                        const t = (s1.scope || {}).tal || {};
                        const total = Number(t.total_count || 0);
                        const matched = Number(t.match_count || 0);
                        return total > 0 ? `${((matched / total) * 100).toFixed(2)}%` : "—";
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="font-mono-tight text-xs text-[#666] mt-2">
                Match % = Match Count ÷ Total TAL Count · auto-calculated
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ============== SECTION 1: RFP DISCOVERY ============== */}
      <Section title="Section 01 — RFP Discovery">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-5">
          <Field label="RFP Master Tracking Sheet Ref · auto-generated">
            <input
              data-testid="input-rfp-master-sheet"
              className="evcl-input font-mono-tight"
              value={previewRef}
              readOnly
              title="EV_Q_{sequential} + Date of RFP (YYYYMMDD)"
            />
            <div className="font-mono-tight text-xs text-[#666] mt-1">
              Auto-populated from sequence + Date of RFP response
            </div>
          </Field>
          <Field label="Date of RFP Response">
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
          <Field label="Job Seniority (LinkedIn levels)">
            <MultiSelect
              id="job-seniority"
              options={ref.job_seniorities || []}
              value={s1.target_job_seniority || []}
              onChange={(v) => updateS1("target_job_seniority", v)}
              placeholder="Select seniority levels…"
            />
          </Field>
          <Field label="Target Job Titles · paste one per line" span={2}>
            <textarea
              data-testid="input-job-titles"
              className="evcl-input"
              rows={4}
              value={(s1.target_job_titles || []).join("\n")}
              onChange={(e) => {
                const list = e.target.value
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter(Boolean);
                updateS1("target_job_titles", list);
              }}
              placeholder={"Paste one title per line — e.g.\nCTO\nVP Engineering\nHead of Product"}
            />
            <div className="font-mono-tight text-xs text-[#666] mt-1">
              {(s1.target_job_titles || []).length} title(s) captured
            </div>
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

          <Field label="Type of Campaign · multi-select">
            <MultiSelect
              id="campaign-types"
              options={ref.campaign_types || []}
              value={s1.campaign_type_config.types || []}
              onChange={(v) => updateCampType("types", v)}
              placeholder="Select one or more campaign types…"
            />
          </Field>
          <Field label="Number of CQ (MQL only)">
            <input
              type="number" min="0"
              data-testid="input-num-cq"
              className="evcl-input"
              value={s1.campaign_type_config.num_cq}
              onChange={(e) => updateCampType("num_cq", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Number of QQ (MQL only)">
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
          <Field label="With TV (Tele-Verification) · MQL only · −10%">
            <div className="flex gap-2 mt-1">
              {[
                { key: false, label: "Off" },
                { key: true, label: "On · reduce MQL 10%" },
              ].map((opt) => (
                <button
                  type="button"
                  key={String(opt.key)}
                  data-testid={`toggle-with-tv-${opt.key ? "on" : "off"}`}
                  className={`btn-secondary flex-1 ${
                    Boolean(s1.campaign_type_config.with_tv) === opt.key
                      ? "bg-[#0A0A0A] text-white"
                      : ""
                  }`}
                  onClick={() => updateCampType("with_tv", opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      {/* ============== SECTION 2: DATA UNIVERSE ============== */}
      <Section title="Section 02 — Data Universe (manual input)">
        {(() => {
          const geos = s1.target_geography || [];
          const isSplit = geos.length > 1;
          const byCountry = s2.universe_by_country || {};

          const setSingle = (val) => setRfp((p) => ({
            ...p,
            section2: { ...p.section2, data_universe: Number(val) || 0, universe_by_country: null },
          }));
          const setForGeo = (geo, val) => setRfp((p) => {
            const nextMap = { ...(p.section2.universe_by_country || {}) };
            nextMap[geo] = Number(val) || 0;
            // Drop keys no longer selected in target_geography.
            const validKeys = new Set(p.section1.target_geography || []);
            Object.keys(nextMap).forEach((k) => { if (!validKeys.has(k)) delete nextMap[k]; });
            const sum = Object.values(nextMap).reduce((a, b) => a + (Number(b) || 0), 0);
            return {
              ...p,
              section2: { ...p.section2, universe_by_country: nextMap, data_universe: sum },
            };
          });

          if (isSplit) {
            const total = geos.reduce((acc, g) => acc + (Number(byCountry[g]) || 0), 0);
            return (
              <div data-testid="data-universe-block" className="bg-[#0A0A0A] text-white px-8 py-8">
                <div className="flex items-start justify-between flex-wrap gap-4 mb-5 pb-4 border-b border-white/20">
                  <div className="max-w-md">
                    <div className="font-label text-white/60">Data Universe · Per Geography</div>
                    <div className="font-serif-display italic text-white/70 text-base mt-2">
                      Multiple geographies selected — enter the addressable universe for each. Section 3 uses the total.
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-label text-white/60">Combined Total</div>
                    <div
                      data-testid="data-universe-total"
                      className="kpi-num text-white"
                      style={{ fontSize: "2.2rem" }}
                    >
                      {new Intl.NumberFormat("en-US").format(total)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {geos.map((geo) => (
                    <div key={geo} className="flex items-center justify-between gap-3 border-b border-white/15 pb-2">
                      <label
                        className="font-mono-tight text-sm text-white/85 truncate"
                        title={geo}
                        style={{ maxWidth: "60%" }}
                      >
                        {geo}
                      </label>
                      <input
                        type="number" min="0"
                        data-testid={`input-universe-${geo.replace(/\s+/g, "-").toLowerCase()}`}
                        className="evcl-input text-right"
                        style={{ background: "#1a1a1a", color: "#fff", fontSize: "1.1rem", width: "160px", borderBottomColor: "#fff" }}
                        value={byCountry[geo] || 0}
                        onChange={(e) => setForGeo(geo, e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <div data-testid="data-universe-block" className="bg-[#0A0A0A] text-white px-8 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="max-w-md">
                <div className="font-label text-white/60">Data Universe</div>
                <div className="font-serif-display italic text-white/70 text-base mt-3">
                  Enter the total addressable data universe manually — this is the number the Section 3 lead formulas apply source-conversion % against.
                </div>
              </div>
              <div className="flex items-end gap-3">
                <input
                  type="number" min="0"
                  data-testid="input-data-universe"
                  className="evcl-input text-right"
                  style={{ background: "#1a1a1a", color: "#fff", fontSize: "1.6rem", width: "260px", borderBottomColor: "#fff" }}
                  value={s2.data_universe || 0}
                  onChange={(e) => setSingle(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          );
        })()}
      </Section>

      {/* ============== SECTION 3: LEAD COMPUTATION ============== */}
      <Section title="Section 03 — Computation of Leads Quantity to be Delivered">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-5 mb-6">
          <Field label="Data Source">
            <select
              data-testid="input-data-source"
              className="evcl-input"
              value={s3.data_source || ""}
              onChange={(e) => updateS3("data_source", e.target.value)}
            >
              <option value="">— Select Source —</option>
              {(ref.data_sources || []).map((src) => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          </Field>
          <Field label="Active Lead Types">
            <div data-testid="active-lead-types" className="font-mono-tight text-sm bg-[#F0F0EE] px-3 py-2 border-l-2 border-[#0A0A0A] min-h-[42px] flex items-center">
              {targetedSet.size === 0
                ? "Select Campaign Type(s) in Section 1"
                : Array.from(targetedSet).join(" · ")}
            </div>
          </Field>
          <Field label="Modifiers in play">
            <div className="font-mono-tight text-xs text-[#666] mt-1 space-y-0.5">
              <div>CPC (Contacts/Co) = {s1.contacts_per_company || 0} · ÷{(ref.cpc_divisors || {})[s1.contacts_per_company] || 1}</div>
              <div>CQ (MQL only) = {s1.campaign_type_config.num_cq || 0} · −{(((ref.cq_reductions || {})[s1.campaign_type_config.num_cq] || 0) * 100)}%</div>
              <div>QQ (MQL only) = {s1.campaign_type_config.num_qq || 0} · −{(((ref.qq_reductions || {})[s1.campaign_type_config.num_qq] || 0) * 100)}%</div>
              <div>TV (MQL only) = {s1.campaign_type_config.with_tv ? "ON · −10%" : "OFF"}</div>
            </div>
          </Field>
        </div>
        <div className="overflow-x-auto">
          <table className="evcl-table" data-testid="lead-computation-table">
            <thead>
              <tr>
                <th>Lead Type</th>
                <th className="num">Conv. %</th>
                <th className="num">CPL</th>
                <th className="num">Lead Counts · auto</th>
                <th className="num">Total Cost · auto</th>
              </tr>
            </thead>
            <tbody>
              {s3.rows.map((r, idx) => {
                const pct = (ref.conversion_rates && s3.data_source)
                  ? (ref.conversion_rates[s3.data_source] || {})[r.lead_type] ?? 0
                  : 0;
                const active = targetedSet.has(r.lead_type);
                return (
                  <tr
                    key={r.lead_type}
                    data-testid={`lead-row-${r.lead_type}`}
                    className={active ? "" : "opacity-40"}
                  >
                    <td className="font-mono-tight uppercase">
                      {r.lead_type}
                      {active && <span className="chip ml-2" style={{padding:"0 6px",fontSize:"0.6rem"}}>ACTIVE</span>}
                    </td>
                    <td className="num text-[#666]">{pct ? `${pct}%` : "—"}</td>
                    <td className="num">
                      <input
                        type="number" min="0" step="0.01"
                        data-testid={`input-cpl-${r.lead_type}`}
                        className="evcl-input text-right"
                        value={r.cpl}
                        onChange={(e) => updateRow(idx, "cpl", e.target.value)}
                      />
                    </td>
                    <td className="num" data-testid={`cell-leadcount-${r.lead_type}`}>{fmtNum(r.lead_counts)}</td>
                    <td className="num" data-testid={`cell-total-${r.lead_type}`}>{fmtCurrency(r.total_cost)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-[#0A0A0A] font-semibold">
                <td className="font-label">Totals</td>
                <td></td>
                <td></td>
                <td className="num" data-testid="grand-total-leads">{fmtNum(s3.grand_total_leads)}</td>
                <td className="num" data-testid="grand-total-cost">{fmtCurrency(s3.grand_total_cost)}</td>
              </tr>
              <tr>
                <td colSpan={4} className="font-label text-right pr-3">Blended CPL</td>
                <td className="num" data-testid="blended-cpl">{fmtCurrency(s3.blended_cpl)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="font-mono-tight text-xs text-[#666] mt-3 leading-relaxed">
          Formula per active row: <code>base = Data Universe × source%</code> → <code>÷ CPC divisor</code> → <code>× (1 − CQ%)</code> → <code>× (1 − QQ%)</code> → <code>× 0.9 if TV</code>. Total = CPL × Lead Counts.
        </div>

        {/* Per-country CPL override — only when multi-geo AND ≥1 active lead type */}
        {(() => {
          const geos = s1.target_geography || [];
          const activeLTs = (s3.rows || []).filter((r) => targetedSet.has(r.lead_type));
          if (geos.length <= 1 || activeLTs.length === 0) return null;
          const map = s3.cpl_by_country || {};
          const setCplByCountry = (country, lt, val) => {
            setRfp((p) => {
              const next = { ...(p.section3.cpl_by_country || {}) };
              const row = { ...(next[country] || {}) };
              const num = val === "" || val == null ? undefined : Number(val);
              if (num === undefined || Number.isNaN(num) || num <= 0) delete row[lt];
              else row[lt] = num;
              if (Object.keys(row).length === 0) delete next[country];
              else next[country] = row;
              return { ...p, section3: { ...p.section3, cpl_by_country: next } };
            });
          };
          return (
            <div data-testid="country-cpl-override" className="mt-8 pt-6 border-t border-[#DCDCCF]">
              <div className="font-label mb-2">Per-Country CPL Override · Optional</div>
              <div className="font-mono-tight text-xs text-[#666] mb-4">
                Blank cells fall back to the row-level CPL above. Grand Total Cost becomes the sum of (country leads × country CPL).
              </div>
              <div className="overflow-x-auto">
                <table className="evcl-table" data-testid="country-cpl-table">
                  <thead>
                    <tr>
                      <th>Geography</th>
                      {activeLTs.map((r) => (
                        <th key={r.lead_type} className="num uppercase">
                          {r.lead_type}
                          <div className="font-mono-tight text-[10px] text-[#666] normal-case">
                            default {fmtCurrency(r.cpl)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {geos.map((country) => (
                      <tr key={country}>
                        <td className="font-mono-tight">{country}</td>
                        {activeLTs.map((r) => {
                          const val = ((map[country] || {})[r.lead_type]);
                          return (
                            <td key={r.lead_type} className="num" style={{ padding: "0.4rem" }}>
                              <input
                                type="number" step="0.01" min="0"
                                data-testid={`cpl-${country.replace(/\s+/g, "-").toLowerCase()}-${r.lead_type}`}
                                className="evcl-input text-right"
                                style={{ width: "120px" }}
                                value={val ?? ""}
                                placeholder={`${r.cpl || 0}`}
                                onChange={(e) => setCplByCountry(country, r.lead_type, e.target.value)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
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
