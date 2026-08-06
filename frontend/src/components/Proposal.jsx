import React from "react";
import MultiSelect from "./MultiSelect";
import { previewCompute } from "../lib/apiClient";
import { LEAD_TYPES, fmtNum, fmtCurrency, useDebounce } from "../lib/rfpUtils";
import { Printer, ChevronDown, ChevronUp } from "lucide-react";

const cloneVariant = (rfp) => JSON.parse(JSON.stringify(rfp));

const setDeep = (obj, path, value) => {
  const keys = path.split(".");
  const next = { ...obj };
  let cur = next;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = { ...cur[keys[i]] };
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return next;
};

export default function Proposal({ rfp, reference, onBack }) {
  const [variantA, setVariantA] = React.useState(() => {
    const v = cloneVariant(rfp);
    return { ...v, __label: "Option A · Focused Scope" };
  });
  const [variantB, setVariantB] = React.useState(() => {
    const v = cloneVariant(rfp);
    // Nudge B to be broader by default: adds a modest widening if fields are set
    return { ...v, __label: "Option B · Expanded Reach" };
  });

  const [computedA, setComputedA] = React.useState({ section2: rfp.section2, section3: rfp.section3 });
  const [computedB, setComputedB] = React.useState({ section2: rfp.section2, section3: rfp.section3 });

  const dbA = useDebounce(variantA, 350);
  const dbB = useDebounce(variantB, 350);

  React.useEffect(() => {
    let active = true;
    previewCompute(dbA).then((r) => { if (active) setComputedA(r); }).catch(() => {});
    return () => { active = false; };
  }, [dbA]);
  React.useEffect(() => {
    let active = true;
    previewCompute(dbB).then((r) => { if (active) setComputedB(r); }).catch(() => {});
    return () => { active = false; };
  }, [dbB]);

  const s1 = rfp.section1 || {};
  const ref = reference || {};

  return (
    <div data-testid="proposal-view" className="space-y-8">
      {/* Screen-only toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6 border-b-2 border-[#0A0A0A] no-print">
        <div>
          <div className="font-label">Client Deliverable</div>
          <h2 className="font-serif-display text-4xl md:text-5xl mt-1">RFP Response · Proposal</h2>
          <div className="font-mono-tight text-xs text-[#666] mt-2">
            Two variations · edit demographics on the right of each option to reshape lead volumes.
          </div>
        </div>
        <div className="flex gap-3">
          <button data-testid="proposal-back-button" className="btn-secondary" onClick={onBack}>
            ← Back to list
          </button>
          <button
            data-testid="proposal-print-button"
            className="btn-primary"
            onClick={() => window.print()}
          >
            <Printer size={14} strokeWidth={1.5} className="inline mr-1" /> [ Print / Save PDF ]
          </button>
        </div>
      </div>

      {/* Cover — visible in print */}
      <div className="print-cover panel p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <div className="font-label">Proposal Prepared For</div>
            <div className="font-serif-display text-3xl mt-1">
              {s1.end_client_name || s1.campaign_name || "Client"}
            </div>
            <div className="font-mono-tight text-sm text-[#666] mt-2">
              {s1.campaign_name && <>Campaign: {s1.campaign_name} · </>}
              {s1.campaign_id && <>ID: {s1.campaign_id} · </>}
              {s1.client_id}
            </div>
          </div>
          <div>
            <div className="font-label">Reference</div>
            <div className="font-mono-tight text-sm mt-1">
              {s1.rfp_master_tracking_sheet || "—"}
            </div>
            <div className="font-label mt-4">Prepared</div>
            <div className="font-mono-tight text-sm mt-1">
              {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "2-digit" })}
            </div>
            <div className="font-label mt-4">Campaign Window</div>
            <div className="font-mono-tight text-sm mt-1">
              {(s1.campaign_run_date && s1.campaign_run_date.start_date) || "—"}
              {" → "}
              {(s1.campaign_run_date && s1.campaign_run_date.end_date) || "—"}
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-[#DCDCCF]">
          <div className="font-label">Executive Summary</div>
          <p className="font-serif-display italic text-lg leading-snug mt-2 max-w-3xl">
            We are pleased to propose the following two options for this campaign. Option A represents the tightest interpretation of the brief; Option B expands the target parameters to deliver higher volumes at the same commercial terms. Both options are calibrated against the same conversion matrix and quality bar.
          </p>
        </div>
      </div>

      {/* Options grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VariantCard
          testId="variant-a"
          variant={variantA}
          setVariant={setVariantA}
          computed={computedA}
          reference={ref}
          accent="black"
        />
        <VariantCard
          testId="variant-b"
          variant={variantB}
          setVariant={setVariantB}
          computed={computedB}
          reference={ref}
          accent="red"
        />
      </div>

      {/* Side-by-side comparison */}
      <ComparisonTable
        variantA={variantA}
        computedA={computedA}
        variantB={variantB}
        computedB={computedB}
      />

      {/* Terms footer */}
      <div className="panel p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <TermsBlock title="Commercial Terms">
            Net 30 payment. Priced per lead delivered. Non-conforming leads replaced free of charge within 5 business days.
          </TermsBlock>
          <TermsBlock title="Quality SLA">
            Minimum 95% valid rate. All leads pass double opt-in and email deliverability checks. Suppression file honored.
          </TermsBlock>
          <TermsBlock title="Validity">
            This proposal is valid for 30 days from the Prepared date shown above. Volume estimates are calibrated live from the demographic parameters on this page.
          </TermsBlock>
        </div>
      </div>

      {/* Print CSS */}
      <style>{`
        @media print {
          .no-print, header, footer, [data-testid="tab-nav"] { display: none !important; }
          body { background: #fff !important; }
          .panel { border: 1px solid #000; break-inside: avoid; }
          .variant-editor { display: none !important; }
          section, .print-cover { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Variant card: client-facing headline + editable demographic panel   //
// ------------------------------------------------------------------ //
function VariantCard({ testId, variant, setVariant, computed, reference, accent }) {
  const [showEditor, setShowEditor] = React.useState(false);
  const s1 = variant.section1 || {};
  const cfg = s1.campaign_type_config || {};
  const s3 = computed.section3 || {};
  const s2 = computed.section2 || {};
  const activeRows = (s3.rows || []).filter((r) => r.lead_counts > 0);

  const accentBar =
    accent === "red" ? "bg-[#D92D20]" : "bg-[#0A0A0A]";

  const update = (path, value) => setVariant((v) => setDeep(v, path, value));

  return (
    <div data-testid={testId} className="panel">
      <div className={`h-2 ${accentBar}`} />
      <div className="p-6 md:p-8 space-y-6">
        {/* Editable label */}
        <input
          data-testid={`${testId}-label`}
          className="evcl-input font-serif-display text-2xl"
          value={variant.__label || ""}
          onChange={(e) => setVariant((v) => ({ ...v, __label: e.target.value }))}
        />

        {/* Snapshot chips (client-facing) */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <SnapChip label="Data Universe">
            <span className="font-mono-tight text-base font-semibold">
              {fmtNum(s2.data_universe)}
            </span>
          </SnapChip>
          <SnapChip label="Data Source">
            <span className="font-mono-tight text-base">{(variant.section3 || {}).data_source || "—"}</span>
          </SnapChip>
          <SnapChip label="Geography">{listPreview(s1.target_geography)}</SnapChip>
          <SnapChip label="Industries">{listPreview(s1.target_industries)}</SnapChip>
          <SnapChip label="Revenue">{listPreview(s1.revenue_size)}</SnapChip>
          <SnapChip label="Employees">{listPreview(s1.employee_size)}</SnapChip>
          <SnapChip label="Job Functions">{listPreview(s1.target_job_functions)}</SnapChip>
          <SnapChip label="Seniority">{listPreview(s1.target_job_seniority)}</SnapChip>
          <SnapChip label="Titles">
            {(s1.target_job_titles || []).length > 0
              ? `${(s1.target_job_titles || []).length} titles`
              : "—"}
          </SnapChip>
          <SnapChip label="Campaign Type">
            {listPreview(cfg.types)}
          </SnapChip>
        </div>

        {/* Deliverables table (client-facing) */}
        <div>
          <div className="font-label mb-3">Deliverables & Pricing</div>
          <table className="evcl-table" data-testid={`${testId}-deliverables`}>
            <thead>
              <tr>
                <th>Lead Type</th>
                <th className="num">Volume</th>
                <th className="num">CPL</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-4 font-mono-tight text-xs text-[#666]">
                    Configure campaign types and CPL in the editor below to populate.
                  </td>
                </tr>
              )}
              {activeRows.map((r) => (
                <tr key={r.lead_type}>
                  <td className="font-mono-tight uppercase">{r.lead_type}</td>
                  <td className="num" data-testid={`${testId}-vol-${r.lead_type}`}>{fmtNum(r.lead_counts)}</td>
                  <td className="num">{fmtCurrency(r.cpl)}</td>
                  <td className="num" data-testid={`${testId}-total-${r.lead_type}`}>{fmtCurrency(r.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Grand line */}
        <div className="border-t-2 border-[#0A0A0A] pt-4 grid grid-cols-3 gap-4">
          <div>
            <div className="font-label">Total Leads</div>
            <div className="kpi-num" data-testid={`${testId}-total-leads`} style={{ fontSize: "2rem" }}>
              {fmtNum(s3.grand_total_leads)}
            </div>
          </div>
          <div>
            <div className="font-label">Total Cost</div>
            <div className="kpi-num" data-testid={`${testId}-total-cost`} style={{ fontSize: "2rem" }}>
              {fmtCurrency(s3.grand_total_cost)}
            </div>
          </div>
          <div>
            <div className="font-label">Blended CPL</div>
            <div className="kpi-num" data-testid={`${testId}-blended-cpl`} style={{ fontSize: "2rem" }}>
              {fmtCurrency(s3.blended_cpl)}
            </div>
          </div>
        </div>

        {/* Editor toggle (screen only) */}
        <div className="no-print">
          <button
            type="button"
            data-testid={`${testId}-toggle-editor`}
            className="btn-secondary w-full flex items-center justify-center gap-2"
            onClick={() => setShowEditor((s) => !s)}
          >
            {showEditor ? <ChevronUp size={14} strokeWidth={1.5} /> : <ChevronDown size={14} strokeWidth={1.5} />}
            {showEditor ? "[ Hide Editor ]" : "[ Adjust Demographics ]"}
          </button>
        </div>

        {showEditor && (
          <div className="variant-editor no-print space-y-4 pt-4 border-t border-[#DCDCCF]">
            <VariantEditor
              testId={`${testId}-editor`}
              variant={variant}
              reference={reference}
              update={update}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function VariantEditor({ testId, variant, reference, update }) {
  const s1 = variant.section1 || {};
  const cfg = s1.campaign_type_config || {};
  const s3 = variant.section3 || {};
  const s2 = variant.section2 || {};
  const ref = reference || {};

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FieldSmall label="Geography">
          <MultiSelect
            id={`${testId}-geo`}
            options={ref.geographies || []}
            value={s1.target_geography || []}
            onChange={(v) => update("section1.target_geography", v)}
            placeholder="Regions, countries…"
          />
        </FieldSmall>
        <FieldSmall label="Industries">
          <MultiSelect
            id={`${testId}-industries`}
            options={ref.industries || []}
            value={s1.target_industries || []}
            onChange={(v) => update("section1.target_industries", v)}
            placeholder="Industries…"
          />
        </FieldSmall>
        <FieldSmall label="Revenue Bands">
          <MultiSelect
            id={`${testId}-revenue`}
            options={ref.revenue_sizes || []}
            value={s1.revenue_size || []}
            onChange={(v) => update("section1.revenue_size", v)}
            placeholder="Revenue bands…"
          />
        </FieldSmall>
        <FieldSmall label="Employee Sizes">
          <MultiSelect
            id={`${testId}-employee`}
            options={ref.employee_sizes || []}
            value={s1.employee_size || []}
            onChange={(v) => update("section1.employee_size", v)}
            placeholder="Employee bands…"
          />
        </FieldSmall>
        <FieldSmall label="Job Functions">
          <MultiSelect
            id={`${testId}-jobfunc`}
            options={ref.job_functions || []}
            value={s1.target_job_functions || []}
            onChange={(v) => update("section1.target_job_functions", v)}
            placeholder="Functions…"
          />
        </FieldSmall>
        <FieldSmall label="Job Seniority">
          <MultiSelect
            id={`${testId}-seniority`}
            options={ref.job_seniorities || []}
            value={s1.target_job_seniority || []}
            onChange={(v) => update("section1.target_job_seniority", v)}
            placeholder="Seniority levels…"
          />
        </FieldSmall>
      </div>

      <FieldSmall label="Job Titles · paste one per line">
        <textarea
          data-testid={`${testId}-titles`}
          className="evcl-input"
          rows={3}
          value={(s1.target_job_titles || []).join("\n")}
          onChange={(e) => {
            const list = e.target.value
              .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            update("section1.target_job_titles", list);
          }}
        />
      </FieldSmall>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FieldSmall label="Contacts / Company (CPC 1-5)">
          <input
            type="number" min="0" max="5"
            data-testid={`${testId}-cpc`}
            className="evcl-input"
            value={s1.contacts_per_company || 0}
            onChange={(e) => update("section1.contacts_per_company", Number(e.target.value) || 0)}
          />
        </FieldSmall>
        <FieldSmall label="Num CQ (1-5)">
          <input
            type="number" min="0" max="5"
            data-testid={`${testId}-num-cq`}
            className="evcl-input"
            value={cfg.num_cq || 0}
            onChange={(e) => update("section1.campaign_type_config.num_cq", Number(e.target.value) || 0)}
          />
        </FieldSmall>
        <FieldSmall label="Num QQ (1-5)">
          <input
            type="number" min="0" max="5"
            data-testid={`${testId}-num-qq`}
            className="evcl-input"
            value={cfg.num_qq || 0}
            onChange={(e) => update("section1.campaign_type_config.num_qq", Number(e.target.value) || 0)}
          />
        </FieldSmall>
        <FieldSmall label="With TV">
          <button
            type="button"
            data-testid={`${testId}-tv-toggle`}
            className={`btn-secondary w-full ${cfg.with_tv ? "bg-[#0A0A0A] text-white" : ""}`}
            onClick={() => update("section1.campaign_type_config.with_tv", !cfg.with_tv)}
          >
            {cfg.with_tv ? "On · −10%" : "Off"}
          </button>
        </FieldSmall>
      </div>

      <FieldSmall label="Campaign Types (drives active lead-type rows)">
        <MultiSelect
          id={`${testId}-types`}
          options={ref.campaign_types || []}
          value={cfg.types || []}
          onChange={(v) => update("section1.campaign_type_config.types", v)}
          placeholder="Select campaign types…"
        />
      </FieldSmall>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FieldSmall label="Data Source">
          <select
            data-testid={`${testId}-source`}
            className="evcl-input"
            value={s3.data_source || ""}
            onChange={(e) => update("section3.data_source", e.target.value)}
          >
            <option value="">— Select Source —</option>
            {(ref.data_sources || []).map((src) => (
              <option key={src} value={src}>{src}</option>
            ))}
          </select>
        </FieldSmall>
        <FieldSmall label="Data Universe (override)">
          <input
            type="number" min="0"
            data-testid={`${testId}-universe`}
            className="evcl-input"
            value={s2.data_universe || 0}
            onChange={(e) => update("section2.data_universe", Number(e.target.value) || 0)}
            placeholder="0 = auto-suggest from filters"
          />
        </FieldSmall>
      </div>

      <div>
        <div className="font-label mb-2">CPL per Lead Type</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {LEAD_TYPES.map((lt) => {
            const row = (s3.rows || []).find((r) => r.lead_type === lt) || { cpl: 0 };
            const idx = (s3.rows || []).findIndex((r) => r.lead_type === lt);
            return (
              <FieldSmall key={lt} label={lt}>
                <input
                  type="number" min="0" step="0.01"
                  data-testid={`${testId}-cpl-${lt}`}
                  className="evcl-input"
                  value={row.cpl || 0}
                  onChange={(e) => {
                    const rows = [...(s3.rows || [])];
                    if (idx >= 0) {
                      rows[idx] = { ...rows[idx], cpl: Number(e.target.value) || 0 };
                    } else {
                      rows.push({ lead_type: lt, cpl: Number(e.target.value) || 0, lead_counts: 0, total_cost: 0 });
                    }
                    update("section3.rows", rows);
                  }}
                />
              </FieldSmall>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ComparisonTable({ variantA, computedA, variantB, computedB }) {
  const rowsA = (computedA.section3 || {}).rows || [];
  const rowsB = (computedB.section3 || {}).rows || [];
  const allTypes = LEAD_TYPES.filter((lt) => {
    const a = rowsA.find((r) => r.lead_type === lt);
    const b = rowsB.find((r) => r.lead_type === lt);
    return (a && a.lead_counts > 0) || (b && b.lead_counts > 0);
  });
  return (
    <div className="panel" data-testid="proposal-comparison">
      <div className="p-6 md:p-8">
        <div className="font-label mb-4">Side-by-Side Comparison</div>
        <table className="evcl-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th className="num">{variantA.__label || "Option A"}</th>
              <th className="num">{variantB.__label || "Option B"}</th>
              <th className="num">Δ (B − A)</th>
            </tr>
          </thead>
          <tbody>
            {allTypes.map((lt) => {
              const a = rowsA.find((r) => r.lead_type === lt) || { lead_counts: 0 };
              const b = rowsB.find((r) => r.lead_type === lt) || { lead_counts: 0 };
              const delta = b.lead_counts - a.lead_counts;
              return (
                <tr key={lt} data-testid={`compare-row-${lt}`}>
                  <td className="font-mono-tight uppercase">{lt}</td>
                  <td className="num">{fmtNum(a.lead_counts)}</td>
                  <td className="num">{fmtNum(b.lead_counts)}</td>
                  <td className={`num ${delta > 0 ? "text-[#039855]" : delta < 0 ? "text-[#D92D20]" : ""}`}>
                    {delta > 0 ? "+" : ""}{fmtNum(delta)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-[#0A0A0A] font-semibold">
              <td className="font-label">Total Leads</td>
              <td className="num">{fmtNum((computedA.section3 || {}).grand_total_leads)}</td>
              <td className="num">{fmtNum((computedB.section3 || {}).grand_total_leads)}</td>
              <td className="num">
                {fmtNum(((computedB.section3 || {}).grand_total_leads || 0) - ((computedA.section3 || {}).grand_total_leads || 0))}
              </td>
            </tr>
            <tr>
              <td className="font-label">Total Cost</td>
              <td className="num">{fmtCurrency((computedA.section3 || {}).grand_total_cost)}</td>
              <td className="num">{fmtCurrency((computedB.section3 || {}).grand_total_cost)}</td>
              <td className="num">
                {fmtCurrency(((computedB.section3 || {}).grand_total_cost || 0) - ((computedA.section3 || {}).grand_total_cost || 0))}
              </td>
            </tr>
            <tr>
              <td className="font-label">Blended CPL</td>
              <td className="num">{fmtCurrency((computedA.section3 || {}).blended_cpl)}</td>
              <td className="num">{fmtCurrency((computedB.section3 || {}).blended_cpl)}</td>
              <td className="num">
                {fmtCurrency(((computedB.section3 || {}).blended_cpl || 0) - ((computedA.section3 || {}).blended_cpl || 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Small helpers                                                       //
// ------------------------------------------------------------------ //
const SnapChip = ({ label, children }) => (
  <div>
    <div className="font-label">{label}</div>
    <div className="font-mono-tight text-sm text-[#0A0A0A] mt-1">{children}</div>
  </div>
);

const FieldSmall = ({ label, children }) => (
  <div>
    <label className="font-label block mb-1">{label}</label>
    {children}
  </div>
);

const TermsBlock = ({ title, children }) => (
  <div>
    <div className="font-label">{title}</div>
    <div className="font-mono-tight text-sm text-[#0A0A0A] leading-relaxed mt-2">{children}</div>
  </div>
);

const listPreview = (arr) => {
  const list = Array.isArray(arr) ? arr : [];
  if (list.length === 0) return "—";
  if (list.length <= 3) return list.join(", ");
  return `${list.slice(0, 3).join(", ")} +${list.length - 3} more`;
};
