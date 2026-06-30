# RFP Master Tracking — PRD

## Original problem statement
Build an app per the attached RFP Master Tracking spec image (Section 1 RFP Discovery, Section 2 Data Universe Estimation, Section 3 Computation of Leads Qty, Section 4 RFP Status). Iteration 2: per follow-up spec, Section 3 sources lead counts from a chosen Data Source (LinkedIn / Prospeo / Apollo / VibeProspect) × manually-entered Data Counts × per-source conversion %.

## User choices
- Single form (no multi-step wizard)
- Single-tenant, no auth
- Auto-compute Section 2 (universe) and Section 3 (lead counts, CPL, totals)
- Both CSV + Excel export, plus summary dashboard with charts
- Design picked by design agent → "Editorial Terminal / Old Money Tech" (Cormorant Garamond + IBM Plex Mono, B/W + red/green accents)

## Architecture
- **Backend**: FastAPI + Motor + MongoDB (collection `rfps`), endpoints under `/api/`. Computation server-side in `compute_data_universe` and `compute_section3`. Exports via `openpyxl` (xlsx) + stdlib `csv`.
- **Frontend**: React 19 + Tailwind + Recharts. Debounced `POST /api/rfps/preview` calls re-compute Sections 2 & 3 live as user edits; merge preserves user-typed CPC / data_source / data_counts (race-safe).

## Endpoints
- `GET /api/reference` — dropdown source data + `lead_multipliers` + `data_sources` + `conversion_rates`.
- `POST /api/rfps`, `GET /api/rfps`, `GET /api/rfps/{id}`, `PUT /api/rfps/{id}`, `DELETE /api/rfps/{id}`.
- `POST /api/rfps/preview` — recompute Sections 2 & 3 without persisting.
- `GET /api/rfps/stats` — KPIs, lead-type distribution, monthly series, top clients.
- `GET /api/rfps/export/csv`, `GET /api/rfps/export/xlsx`.

## Section 3 computation rules (iter 2)
- `Lead Counts[type] = round(data_counts × conversion_rate[source][type] / 100, 0)` when source set AND counts > 0; else 0.
- `CPL = round(CPC × multiplier[type], 2)` (CPC is plain numeric, not currency).
- `Total Cost = round(CPL × Lead Counts, 2)`.
- `grand_total_leads = Σ Lead Counts`, `grand_total_cost = Σ Total Cost`, `blended_cpl = grand_total_cost / grand_total_leads`.

### Conversion-rate matrix (% of Data Counts)
| Lead Type | VibeProspect | Prospeo | Apollo | LinkedIn¹ |
|---|---|---|---|---|
| MQL+1/2/3CQ | 45 | 35 | 25 | 45 |
| MQL+1/2/3QQ | 35 | 30 | 20 | 35 |
| MQL SINGLE TOUCH | 55 | 35 | 25 | 55 |
| MQL DOUBLE TOUCH | 45 | 30 | 20 | 45 |
| MQL MULTI-TOUCH | 35 | 25 | 20 | 35 |
| HQL | 25 | 20 | 15 | 25 |
| BANT | 10 | 5 | 5 | 10 |
| AG | 3 | 3 | 3 | 3 |

¹ LinkedIn defaults to VibeProspect rates (user did not supply LinkedIn-specific rates).

## Implemented
- **Iteration 1 (Jan 2026)**: 4-section RFP form with chip-style multiselects; live auto-compute of Data Universe (filter heuristic) and Section 3 CPL/Total; RFP list view with search & status filters; edit + delete; Dashboard with 4 KPI cards + 3 Recharts + lead-breakdown table; CSV + XLSX export (XLSX has secondary Leads-Detail sheet); editorial design system (Cormorant Garamond + IBM Plex Mono).
- **Iteration 2 (Jan 2026)**: Added `data_source` + `data_counts` to Section 3; Lead Counts now auto-derived from the conversion-rate matrix; CPC column is plain numeric (no `$`); per-row Conv. % column added to the table; race-safe preview merge (preserves user-typed values mid-flight); strict spec compliance — lead_counts forced to 0 when source/counts missing.
- **Testing**: 24/24 backend pytest + full Playwright E2E pass (`/app/test_reports/iteration_2.json`, 100% / 100%).

## Backlog
- P1: Validate end_date ≥ start_date in form.
- P1: PDF export of single RFP detail (branded).
- P2: Bulk XLSX import; RFP-vs-RFP compare view.
- P2: Per-RFP override of conversion-rate matrix (currently global).
- P2: Auth (JWT or Emergent Google) when multi-tenant needed.
- P2: Custom LinkedIn-specific conversion rates (currently aliased to VibeProspect).

## Suggested enhancement (engagement)
Add a one-click **"Win-rate Insights" panel** on the Dashboard: per Client ID, surface historical conversion rate, projected CPL and trend lines — turns the tracker into a forward-looking deal-intelligence tool.
