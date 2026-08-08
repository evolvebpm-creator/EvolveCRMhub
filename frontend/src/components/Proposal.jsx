import React from "react";
import html2canvas from "html2canvas";
import MultiSelect from "./MultiSelect";
import { previewCompute } from "../lib/apiClient";
import { LEAD_TYPES, fmtNum, fmtCurrency, useDebounce } from "../lib/rfpUtils";
import { Printer, ChevronDown, ChevronUp, Camera } from "lucide-react";

// Preset client logos shipped with the app.
const PRESET_CLIENT_LOGOS = [
  { name: "Encore Media Group", src: "/client-logos/encore.png" },
  { name: "LeadScale", src: "/client-logos/leadscale.png" },
  { name: "B2B Media Group", src: "/client-logos/b2bmg.jpeg" },
  { name: "BR", src: "/client-logos/br.jpeg" },
];

const cloneVariant = (rfp) => JSON.parse(JSON.stringify(rfp));

// CPC divisor table (mirrors backend server.py CPC_DIVISORS)
const CPC_DIVISORS = { 1: 5.0, 2: 3.0, 3: 2.0, 4: 1.5, 5: 1.25 };
const CQ_REDUCTIONS = { 1: 15, 2: 25, 3: 35, 4: 45, 5: 50 };
const QQ_REDUCTIONS = { 1: 25, 2: 35, 3: 45, 4: 50, 5: 60 };
const TV_REDUCTION_PCT = 10;

// Compare demographic + modifier deltas between the current variant and Option A.
const diffFromBaseline = (base, curr) => {
  const changes = [];
  const bs1 = (base.section1) || {};
  const cs1 = (curr.section1) || {};
  const bcfg = bs1.campaign_type_config || {};
  const ccfg = cs1.campaign_type_config || {};

  const listDiff = (label, a = [], b = []) => {
    const A = new Set(a || []);
    const B = new Set(b || []);
    const added = [...B].filter((x) => !A.has(x));
    const removed = [...A].filter((x) => !B.has(x));
    if (added.length || removed.length) changes.push({ label, added, removed, kind: "list" });
  };
  const scalarDiff = (label, a, b, fmt = (x) => String(x ?? "—")) => {
    if ((a ?? "") !== (b ?? "")) changes.push({ label, from: fmt(a), to: fmt(b), kind: "scalar" });
  };

  listDiff("Geography", bs1.target_geography, cs1.target_geography);
  listDiff("Industries", bs1.target_industries, cs1.target_industries);
  listDiff("Revenue Bands", bs1.revenue_size, cs1.revenue_size);
  listDiff("Employee Sizes", bs1.employee_size, cs1.employee_size);
  listDiff("Job Functions", bs1.target_job_functions, cs1.target_job_functions);
  listDiff("Job Seniority", bs1.target_job_seniority, cs1.target_job_seniority);
  listDiff("Job Titles", bs1.target_job_titles, cs1.target_job_titles);
  listDiff("Campaign Types", bcfg.types, ccfg.types);

  scalarDiff("Contacts / Company (CPC)", bs1.contacts_per_company, cs1.contacts_per_company);
  scalarDiff("Number of CQ", bcfg.num_cq, ccfg.num_cq);
  scalarDiff("Number of QQ", bcfg.num_qq, ccfg.num_qq);
  scalarDiff(
    "Tele-Verification (TV)",
    bcfg.with_tv, ccfg.with_tv,
    (x) => (x ? "On (−10% MQL)" : "Off")
  );
  scalarDiff("Data Source", (base.section3 || {}).data_source, (curr.section3 || {}).data_source);
  scalarDiff(
    "Data Universe",
    (base.section2 || {}).data_universe,
    (curr.section2 || {}).data_universe,
    (x) => new Intl.NumberFormat("en-US").format(Number(x || 0))
  );

  return changes;
};

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
  const [clientLogo, setClientLogo] = React.useState(rfp?.section1?.client_logo || "");
  const [capturing, setCapturing] = React.useState(false);
  const proposalRef = React.useRef(null);

  const handleLogoUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      alert("Please upload a logo under 500KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setClientLogo(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const snapshotFilename = () => {
    const client = (rfp?.section1?.end_client_name || rfp?.section1?.campaign_name || "Proposal")
      .replace(/[^\w\s.-]/g, "").replace(/\s+/g, "_");
    const ref = rfp?.section1?.rfp_master_tracking_sheet || "";
    return `EvolveBPM_${client}${ref ? "_" + ref : ""}_Proposal.png`;
  };

  const captureSnapshot = async (mode = "download") => {
    if (!proposalRef.current) return;
    setCapturing(true);
    try {
      // Temporarily hide screen-only chrome so the snapshot mirrors the print output.
      const root = proposalRef.current;
      const hidden = root.querySelectorAll(".no-print, .variant-editor");
      hidden.forEach((n) => n.setAttribute("data-snap-hidden", "1"));
      hidden.forEach((n) => (n.style.display = "none"));
      // Reveal the branded print footer during capture.
      const brandFooter = root.querySelector(".print-brand-footer");
      const prevBrandDisplay = brandFooter ? brandFooter.style.display : null;
      if (brandFooter) brandFooter.style.display = "block";

      // Wait for layout to settle after DOM changes.
      await new Promise((r) => setTimeout(r, 60));

      const canvas = await html2canvas(root, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: root.scrollWidth,
      });

      // Restore chrome.
      hidden.forEach((n) => { n.style.display = ""; n.removeAttribute("data-snap-hidden"); });
      if (brandFooter) brandFooter.style.display = prevBrandDisplay || "";

      const dataUrl = canvas.toDataURL("image/png");
      if (mode === "download") {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = snapshotFilename();
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (mode === "copy") {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          alert("Snapshot copied to clipboard — paste it into email or chat.");
        } catch (err) {
          alert("Copy to clipboard not supported here. The image download will start instead.");
          const a = document.createElement("a");
          a.href = dataUrl; a.download = snapshotFilename();
          document.body.appendChild(a); a.click(); a.remove();
        }
      } else if (mode === "preview") {
        const w = window.open("", "_blank");
        if (w) {
          w.document.write(
            `<title>${snapshotFilename()}</title>
             <body style="margin:0;background:#111;display:flex;justify-content:center;">
               <img src="${dataUrl}" style="max-width:100%;height:auto;"/>
             </body>`
          );
        }
      }
    } catch (e) {
      console.error("Snapshot failed", e);
      alert("Could not capture snapshot — please try again.");
    } finally {
      setCapturing(false);
    }
  };
  const [variantA, setVariantA] = React.useState(() => {
    const v = cloneVariant(rfp);
    return { ...v, __label: "Option A · Focused Scope" };
  });
  const [variantB, setVariantB] = React.useState(() => {
    const v = cloneVariant(rfp);
    return { ...v, __label: "Option B · Expanded Reach" };
  });
  const [variantC, setVariantC] = React.useState(() => {
    const v = cloneVariant(rfp);
    return { ...v, __label: "Option C · Premium Scale" };
  });

  const [computedA, setComputedA] = React.useState({ section2: rfp.section2, section3: rfp.section3 });
  const [computedB, setComputedB] = React.useState({ section2: rfp.section2, section3: rfp.section3 });
  const [computedC, setComputedC] = React.useState({ section2: rfp.section2, section3: rfp.section3 });

  const dbA = useDebounce(variantA, 350);
  const dbB = useDebounce(variantB, 350);
  const dbC = useDebounce(variantC, 350);

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
  React.useEffect(() => {
    let active = true;
    previewCompute(dbC).then((r) => { if (active) setComputedC(r); }).catch(() => {});
    return () => { active = false; };
  }, [dbC]);

  const s1 = rfp.section1 || {};
  const ref = reference || {};

  return (
    <div data-testid="proposal-view" className="space-y-8" ref={proposalRef}>
      {/* Screen-only toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6 border-b-2 border-[#0A0A0A] no-print">
        <div>
          <div className="font-label">Client Deliverable</div>
          <h2 className="font-serif-display text-4xl md:text-5xl mt-1">RFP Response · Proposal</h2>
          <div className="font-mono-tight text-xs text-[#666] mt-2">
            Two variations · edit demographics on the right of each option to reshape lead volumes.
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button data-testid="proposal-back-button" className="btn-secondary" onClick={onBack}>
            ← Back to list
          </button>
          <button
            data-testid="proposal-snapshot-download"
            className="btn-secondary"
            disabled={capturing}
            onClick={() => captureSnapshot("download")}
            title="Download proposal as a PNG image"
          >
            <Camera size={14} strokeWidth={1.5} className="inline mr-1" />
            {capturing ? "[ Capturing… ]" : "[ Save PNG Snapshot ]"}
          </button>
          <button
            data-testid="proposal-snapshot-copy"
            className="btn-secondary"
            disabled={capturing}
            onClick={() => captureSnapshot("copy")}
            title="Copy snapshot to clipboard — paste into email / chat"
          >
            [ Copy to Clipboard ]
          </button>
          <button
            data-testid="proposal-print-button"
            className="btn-primary"
            onClick={() => {
              const originalTitle = document.title;
              const client = (rfp?.section1?.end_client_name || rfp?.section1?.campaign_name || "RFP Response").replace(/[^\w\s.-]/g, "");
              const ref = rfp?.section1?.rfp_master_tracking_sheet || "";
              document.title = `EvolveBPM · ${client}${ref ? " · " + ref : ""} · Proposal`;
              setTimeout(() => {
                window.print();
                setTimeout(() => { document.title = originalTitle; }, 100);
              }, 50);
            }}
          >
            <Printer size={14} strokeWidth={1.5} className="inline mr-1" /> [ Print / Save PDF ]
          </button>
        </div>
      </div>

      {/* Cover — visible in print */}
      <div className="print-cover panel p-8">
        {/* Agency brand strip */}
        <div className="flex items-center justify-between pb-6 mb-6 border-b border-[#DCDCCF]">
          <img
            src="/evolvebpm-logo.png"
            alt="EvolveBPM"
            data-testid="proposal-agency-logo"
            className="h-16 md:h-20 w-auto"
          />
          {clientLogo ? (
            <div className="text-right flex flex-col items-end">
              <div className="font-label">Prepared For</div>
              <img
                src={clientLogo}
                alt="Client logo"
                data-testid="proposal-client-logo"
                crossOrigin="anonymous"
                className="max-h-16 md:max-h-20 w-auto mt-2"
              />
              <div className="flex items-center gap-2 mt-2 no-print">
                <button
                  type="button"
                  data-testid="proposal-client-logo-change"
                  className="font-mono-tight text-xs text-[#0A0A0A] underline"
                  onClick={() => setClientLogo("")}
                >
                  change
                </button>
                <span className="text-[#666]">·</span>
                <button
                  type="button"
                  data-testid="proposal-client-logo-remove"
                  className="font-mono-tight text-xs text-[#D92D20]"
                  onClick={() => setClientLogo("")}
                >
                  remove
                </button>
              </div>
            </div>
          ) : (
            <div className="text-right">
              <div className="font-label">Prepared By</div>
              <div className="font-serif-display text-lg mt-1">EvolveBPM</div>
              <div className="font-mono-tight text-xs text-[#666] italic">Decoding the sales ecosystem</div>
              <div className="mt-3 no-print" data-testid="proposal-preset-logos">
                <div className="font-label mb-1.5">Client Logo Presets</div>
                <div className="flex flex-wrap gap-2 justify-end">
                  {PRESET_CLIENT_LOGOS.map((l) => (
                    <button
                      key={l.src}
                      type="button"
                      data-testid={`preset-logo-${l.name.replace(/\s+/g, "-").toLowerCase()}`}
                      onClick={() => setClientLogo(l.src)}
                      title={`Use ${l.name} logo`}
                      className="border border-[#DCDCCF] hover:border-[#0A0A0A] bg-white p-1 transition-colors"
                      style={{ width: "56px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <img
                        src={l.src}
                        alt={l.name}
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                      />
                    </button>
                  ))}
                </div>
                <label
                  data-testid="proposal-client-logo-upload"
                  className="btn-secondary inline-block mt-3 cursor-pointer"
                  style={{ padding: "0.4rem 0.75rem", fontSize: "0.65rem" }}
                >
                  [ + Upload Custom Logo ]
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

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
            We are pleased to propose the following three options for this campaign. Option A represents the tightest interpretation of the brief, Option B expands the target parameters to deliver higher volumes, and Option C offers premium scale for maximum reach. All three are calibrated against the same conversion matrix and quality bar.
          </p>
        </div>
      </div>

      {/* Options grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <VariantCard
          testId="variant-a"
          variant={variantA}
          setVariant={setVariantA}
          computed={computedA}
          reference={ref}
          accent="black"
          isBaseline
        />
        <VariantCard
          testId="variant-b"
          variant={variantB}
          setVariant={setVariantB}
          computed={computedB}
          reference={ref}
          accent="red"
          baseline={variantA}
        />
        <VariantCard
          testId="variant-c"
          variant={variantC}
          setVariant={setVariantC}
          computed={computedC}
          reference={ref}
          accent="green"
          baseline={variantA}
        />
      </div>

      {/* Side-by-side comparison */}
      <ComparisonTable
        variants={[
          { label: variantA.__label, computed: computedA, testId: "variant-a" },
          { label: variantB.__label, computed: computedB, testId: "variant-b" },
          { label: variantC.__label, computed: computedC, testId: "variant-c" },
        ]}
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
        @page {
          size: A4;
          margin: 14mm 10mm;
        }
        @media print {
          .no-print, header, footer, [data-testid="tab-nav"] { display: none !important; }
          body { background: #fff !important; }
          .panel { border: 1px solid #000; break-inside: avoid; }
          .variant-editor { display: none !important; }
          section, .print-cover { break-inside: avoid; }
          /* Ensure the branded footer prints as the trailing content */
          .print-brand-footer { display: block !important; }
        }
        .print-brand-footer { display: none; }
      `}</style>

      {/* Branded print footer (only visible in print) */}
      <div className="print-brand-footer" style={{marginTop: "24px", paddingTop: "12px", borderTop: "1px solid #DCDCCF", fontFamily: "IBM Plex Mono, monospace", fontSize: "10px", color: "#666", display: "flex", justifyContent: "space-between", alignItems: "center"}}>
        <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
          <img src="/evolvebpm-logo.png" alt="EvolveBPM" style={{height: "20px", width: "auto"}} />
          <span>EvolveBPM · Decoding the sales ecosystem</span>
        </div>
        <div>Confidential · For addressee only</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Variant card: client-facing headline + editable demographic panel   //
// ------------------------------------------------------------------ //
function VariantCard({ testId, variant, setVariant, computed, reference, accent, baseline, isBaseline }) {
  const [showEditor, setShowEditor] = React.useState(false);
  const s1 = variant.section1 || {};
  const cfg = s1.campaign_type_config || {};
  const s3 = computed.section3 || {};
  const s2 = computed.section2 || {};
  const activeRows = (s3.rows || []).filter((r) => r.lead_counts > 0);

  const cpcVal = Number(s1.contacts_per_company || 0);
  const cpcDivisor = CPC_DIVISORS[cpcVal];
  const cqPct = CQ_REDUCTIONS[Number(cfg.num_cq || 0)] || 0;
  const qqPct = QQ_REDUCTIONS[Number(cfg.num_qq || 0)] || 0;

  const changes = !isBaseline && baseline ? diffFromBaseline(baseline, variant) : [];

  const accentBar =
    accent === "red" ? "bg-[#D92D20]" : accent === "green" ? "bg-[#039855]" : "bg-[#0A0A0A]";

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

        {/* Data Universe — prominent editable input per variant */}
        <div className="bg-[#0A0A0A] text-white px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-label text-white/60">Data Universe</div>
            <div className="font-mono-tight text-xs text-white/50 mt-1">
              Manual input · drives Section-3 lead volumes
            </div>
          </div>
          <input
            type="number" min="0"
            data-testid={`${testId}-universe-inline`}
            className="evcl-input text-right"
            style={{background:"#1a1a1a",color:"#fff",fontSize:"1.5rem",width:"200px",borderBottomColor:"#fff"}}
            value={(variant.section2 || {}).data_universe || 0}
            onChange={(e) => setVariant((v) => setDeep(v, "section2.data_universe", Number(e.target.value) || 0))}
          />
        </div>

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

        {/* Modifiers strip — CPC, CQ, QQ, TV (client-visible & prints) */}
        <div data-testid={`${testId}-modifiers`} className="border border-[#DCDCCF] bg-[#FAFAF5] px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="font-label">CPC Limit</div>
            <div className="font-mono-tight text-sm mt-1" data-testid={`${testId}-mod-cpc`}>
              {cpcVal > 0 ? (
                <>
                  {cpcVal} <span className="text-[#666]">contact{cpcVal > 1 ? "s" : ""} / company</span>
                  {cpcDivisor && (
                    <div className="text-[#666] text-xs">÷ {cpcDivisor} divisor</div>
                  )}
                </>
              ) : "—"}
            </div>
          </div>
          <div>
            <div className="font-label">Custom Questions</div>
            <div className="font-mono-tight text-sm mt-1" data-testid={`${testId}-mod-cq`}>
              {cfg.num_cq > 0 ? (
                <>
                  {cfg.num_cq} CQ
                  <div className="text-[#666] text-xs">−{cqPct}% on MQL</div>
                </>
              ) : "—"}
            </div>
          </div>
          <div>
            <div className="font-label">Qualifying Questions</div>
            <div className="font-mono-tight text-sm mt-1" data-testid={`${testId}-mod-qq`}>
              {cfg.num_qq > 0 ? (
                <>
                  {cfg.num_qq} QQ
                  <div className="text-[#666] text-xs">−{qqPct}% on MQL</div>
                </>
              ) : "—"}
            </div>
          </div>
          <div>
            <div className="font-label">Tele-Verification</div>
            <div className="font-mono-tight text-sm mt-1" data-testid={`${testId}-mod-tv`}>
              {cfg.with_tv ? (
                <>
                  On
                  <div className="text-[#666] text-xs">−{TV_REDUCTION_PCT}% on MQL</div>
                </>
              ) : "Off"}
            </div>
          </div>
        </div>

        {/* Changes vs Option A — only rendered on Options B & C */}
        {!isBaseline && (
          <div data-testid={`${testId}-changes`} className="border-l-4 border-[#0A0A0A] bg-white px-4 py-3">
            <div className="font-label">Changes vs Option A</div>
            {changes.length === 0 ? (
              <div className="font-mono-tight text-xs text-[#666] mt-2">
                No demographic or modifier changes — identical scope to Option A.
              </div>
            ) : (
              <ul className="mt-2 space-y-1.5 font-mono-tight text-xs">
                {changes.map((c, i) => (
                  <li key={i} data-testid={`${testId}-change-${i}`} className="leading-snug">
                    <span className="uppercase text-[#0A0A0A] font-semibold">{c.label}:</span>{" "}
                    {c.kind === "scalar" ? (
                      <span>
                        <span className="text-[#D92D20]">{c.from}</span>
                        <span className="text-[#666]"> → </span>
                        <span className="text-[#039855]">{c.to}</span>
                      </span>
                    ) : (
                      <span>
                        {c.added.length > 0 && (
                          <span className="text-[#039855]">+ {c.added.join(", ")}</span>
                        )}
                        {c.added.length > 0 && c.removed.length > 0 && <span> · </span>}
                        {c.removed.length > 0 && (
                          <span className="text-[#D92D20]">− {c.removed.join(", ")}</span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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

function ComparisonTable({ variants }) {
  const rowsPer = variants.map((v) => (v.computed.section3 || {}).rows || []);
  const allTypes = LEAD_TYPES.filter((lt) =>
    rowsPer.some((rows) => {
      const r = rows.find((x) => x.lead_type === lt);
      return r && r.lead_counts > 0;
    })
  );
  const getRow = (rows, lt) => rows.find((r) => r.lead_type === lt) || { lead_counts: 0 };
  const baseline = 0; // A is the baseline for delta
  return (
    <div className="panel" data-testid="proposal-comparison">
      <div className="p-6 md:p-8">
        <div className="font-label mb-4">Side-by-Side Comparison</div>
        <table className="evcl-table">
          <thead>
            <tr>
              <th>Metric</th>
              {variants.map((v, i) => (
                <th key={i} className="num">{v.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allTypes.map((lt) => (
              <tr key={lt} data-testid={`compare-row-${lt}`}>
                <td className="font-mono-tight uppercase">{lt}</td>
                {rowsPer.map((rows, i) => {
                  const r = getRow(rows, lt);
                  const baseCount = getRow(rowsPer[baseline], lt).lead_counts || 0;
                  const delta = r.lead_counts - baseCount;
                  return (
                    <td key={i} className="num">
                      {fmtNum(r.lead_counts)}
                      {i !== baseline && delta !== 0 && (
                        <span className={`font-mono-tight text-xs ml-2 ${delta > 0 ? "text-[#039855]" : "text-[#D92D20]"}`}>
                          ({delta > 0 ? "+" : ""}{fmtNum(delta)})
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t-2 border-[#0A0A0A] font-semibold">
              <td className="font-label">Total Leads</td>
              {variants.map((v, i) => (
                <td key={i} className="num">{fmtNum((v.computed.section3 || {}).grand_total_leads)}</td>
              ))}
            </tr>
            <tr>
              <td className="font-label">Total Cost</td>
              {variants.map((v, i) => (
                <td key={i} className="num">{fmtCurrency((v.computed.section3 || {}).grand_total_cost)}</td>
              ))}
            </tr>
            <tr>
              <td className="font-label">Blended CPL</td>
              {variants.map((v, i) => (
                <td key={i} className="num">{fmtCurrency((v.computed.section3 || {}).blended_cpl)}</td>
              ))}
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
