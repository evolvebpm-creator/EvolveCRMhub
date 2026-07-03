# RFP Master Tracking — PRD

## Original problem statement
Build an app per the attached RFP Master Tracking spec image (Section 1 RFP Discovery, Section 2 Data Universe Estimation, Section 3 Computation of Leads Qty, Section 4 RFP Status), with iterative refinements from the user.

## User choices
- Single form, single-tenant, no auth
- Auto-compute Sections 2 & 3
- CSV + Excel export + Dashboard with charts
- Design chosen by design agent → "Editorial Terminal / Old Money Tech" (Cormorant Garamond + IBM Plex Mono, B/W + red/green accents)

## Architecture
- **Backend**: FastAPI + Motor + MongoDB (collection `rfps`). Endpoints under `/api/`. Computation server-side (`compute_data_universe`, `compute_section3`, `campaign_to_lead_types`). Exports via `openpyxl` (xlsx) + stdlib `csv`.
- **Frontend**: React 19 + Tailwind + Recharts. Debounced `POST /api/rfps/preview` calls re-compute Sections 2 & 3 live. Race-safe merge preserves user-typed inputs mid-flight.
- **Tabs**: `[01 / Dashboard]`, `[02 / RFP Tracker]`, `[03 / All RFPs]`.

## Endpoints
- `GET /api/reference` — dropdowns + `data_sources` + `conversion_rates`.
- `POST /api/rfps`, `GET /api/rfps`, `GET /api/rfps/{id}`, `PUT /api/rfps/{id}`, `DELETE /api/rfps/{id}`.
- `POST /api/rfps/preview` — recompute Sections 2 & 3 without persisting.
- `GET /api/rfps/stats` — KPIs, lead-type distribution, monthly series, top clients.
- `GET /api/rfps/export/csv`, `GET /api/rfps/export/xlsx`.

## Section 3 computation rules (current, iter 3)
- Only lead-type rows that map from Section 1's `campaign_type_config.types` receive non-zero lead_counts. Other rows stay 0.
- Mapping: "MQL with CQ" + num_cq=N ∈ {1,2,3} → MQL+NCQ (else all three CQ rows); "MQL with QQ" analogous; "Single/Double/Multi touch" → MQL SINGLE/DOUBLE/MULTI TOUCH; "HQL"/"BANT" direct; "Appointment-setup" → AG; "MQL" → MQL SINGLE TOUCH; "Social Media Spend"/unknown → nothing.
- `Lead Counts = round(Data Counts × conversion_rate[source][lead_type] / 100, 0)` for targeted rows when source AND counts > 0. Else 0.
- `Total Cost = round(CPL × Lead Counts, 2)`. CPL is user-entered numeric (no more CPC × multiplier chain).
- `grand_total_leads = Σ Lead Counts`, `grand_total_cost = Σ Total Cost`, `blended_cpl = grand_total_cost / grand_total_leads`.

### Conversion-rate matrix
| Lead Type | VibeProspect | Prospeo | Apollo | LinkedIn¹ |
|---|---|---|---|---|
| MQL+{1,2,3}CQ | 45 | 35 | 25 | 45 |
| MQL+{1,2,3}QQ | 35 | 30 | 20 | 35 |
| MQL SINGLE TOUCH | 55 | 35 | 25 | 55 |
| MQL DOUBLE TOUCH | 45 | 30 | 20 | 45 |
| MQL MULTI-TOUCH | 35 | 25 | 20 | 35 |
| HQL | 25 | 20 | 15 | 25 |
| BANT | 10 | 5 | 5 | 10 |
| AG | 3 | 3 | 3 | 3 |

¹ LinkedIn defaults to VibeProspect rates (user did not supply LinkedIn-specific rates).

## Implemented timeline
- **Iter 1**: 4-section RFP form; multi-select geo/industries/revenue/employee/job-function/title; auto Universe; auto CPL; list; edit/delete; Dashboard KPIs + Recharts; CSV/XLSX export; editorial design system.
- **Iter 2**: Section 3 gained Data Source + Data Counts inputs; Lead Counts auto-derived from conversion matrix; CPC column dropped `$`; race-safe preview merge.
- **Iter 3 (current)**: (a) Target Job Titles is now a paste-friendly TEXTAREA (one per line, chip count shown); (b) Type of Campaign is now MULTI-SELECT (`section1.campaign_type_config.types: List[str]`); (c) CPC removed from Section 3 — CPL is the direct numeric input; (d) Only lead-type rows matching selected campaign types are calculated (non-active rows dimmed to 40% opacity in UI). Removed dead `LEAD_MULTIPLIERS`/`lead_multipliers` API surface.
- **Iter 4 (current)**: (a) `RFP Master Tracking Sheet Ref` is auto-generated as `EV_Q_{NNN}_{YYYYMMDD}` where NNN is a sequential counter and YYYYMMDD is derived from "Date of RFP Response". Server-authoritative on POST/PUT; UI shows read-only live preview. (b) Section 1 field relabelled `Date of RFP Response`. (c) New separate field `Job Seniority (LinkedIn levels)` as multi-select (`section1.target_job_seniority: List[str]`); Target Job Titles kept as paste textarea for custom entries.
- **Deploy**: production live at https://app-from-specs-9.emergent.host.
- **Testing**: 25/25 backend pytest + full Playwright E2E pass (`/app/test_reports/iteration_4.json`, 100%/100%).

## Backlog
- P1: Validate `end_date ≥ start_date` in form.
- P1: PDF export of single RFP detail (branded).
- P2: Bulk XLSX import; RFP-vs-RFP compare view.
- P2: Per-RFP override of conversion-rate matrix (currently global).
- P2: Custom LinkedIn-specific conversion rates.
- P2: Atomic sequence counter (findAndModify) for `next_seq_num()` — current implementation uses `count_documents+1` which is not concurrency-safe. Fine for single-tenant internal ops.
- P2: Auth (JWT or Emergent Google) if multi-tenant needed.

## Suggested enhancement
"Win-rate Insights" panel on Dashboard: per Client ID, historical conversion rate, projected CPL, trend lines.
