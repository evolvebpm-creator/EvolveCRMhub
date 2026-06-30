# RFP Master Tracking — PRD

## Original problem statement
Build an app per the attached RFP Master Tracking spec image with four sections:
- **Section 1 — RFP Discovery**: Date, Client ID (EVCL001–EVCL100), Campaign name/ID, Target Geography, Industries, Revenue size, Employee size, Job functions/titles, Contacts per company, Exclusions, Suppression file, Type of campaign (MQL / MQL+CQ / MQL+QQ / HQL / BANT / Appointment / Social Media / Single-Double-Multi touch).
- **Section 2 — Data Universe Estimation** (auto-computed).
- **Section 3 — Computation of Leads Qty** — table with rows MQL+1/2/3CQ, MQL+1/2/3QQ, MQL Single/Double/Multi Touch, HQL, BANT, AG; columns CPC, Lead Counts, CPL$ (auto).
- **Section 4 — RFP Status**: Submitted Date, Converted Y/N, Volumes Assigned.

## User choices
- Single form (no multi-step wizard)
- Single-tenant, no auth
- Auto-compute Sections 2 & 3
- Both CSV + Excel export, plus summary dashboard with charts
- Design picked by design agent → "Editorial Terminal / Old Money Tech" (Cormorant Garamond + IBM Plex Mono, B/W + red/green accents)

## Architecture
- **Backend**: FastAPI + Motor + MongoDB (collection `rfps`), endpoints under `/api/`. Computation is server-side in `compute_data_universe` and `compute_section3`. Exports via `openpyxl` (xlsx) and stdlib `csv` (csv).
- **Frontend**: React 19 + Tailwind + Recharts; debounced `/api/rfps/preview` calls drive live Section 2/3 recomputes as the user edits.
- **Tabs**: `[01 / Dashboard]`, `[02 / RFP Tracker]`, `[03 / All RFPs]`.

## Endpoints
- `GET /api/reference` — dropdown source data + lead multipliers.
- `POST /api/rfps`, `GET /api/rfps`, `GET /api/rfps/{id}`, `PUT /api/rfps/{id}`, `DELETE /api/rfps/{id}`.
- `POST /api/rfps/preview` — recompute Section 2 + Section 3 without persisting.
- `GET /api/rfps/stats` — KPIs, lead-type distribution, monthly series, top clients.
- `GET /api/rfps/export/csv`, `GET /api/rfps/export/xlsx`.

## Implemented (Jan 2026)
- Full 4-section RFP form with chip-style multiselects for geo/industries/revenue/employee/job-function/title.
- Live auto-compute: Data Universe (filters → heuristic) and Section 3 CPL = CPC × multiplier, Total = CPL × Lead Count, plus grand totals + blended CPL.
- All RFPs list view with search + status filter, edit + delete actions.
- Dashboard with 4 KPI cards (Total / Converted / Lead Volume / Projected Spend) and 3 Recharts (donut · lead-type distribution, horizontal bar · top clients by leads, line · monthly total vs converted) + lead breakdown table.
- CSV + XLSX export (XLSX has secondary "Leads Detail" sheet).
- Editorial design system (Cormorant Garamond + IBM Plex Mono/Sans, sharp corners, dense Bloomberg-style tables, black/white + red/green accents).
- 14 backend pytest cases + Playwright E2E pass (100% success rate, iteration_1.json).

## Backlog / next ideas
- P1: Validate end_date >= start_date in form.
- P1: PDF export of RFP detail (single sheet, branded).
- P2: Bulk import of RFPs from XLSX.
- P2: Side-by-side compare of two RFPs.
- P2: User auth (JWT or Emergent Google) once multi-tenant is needed.
- P2: Custom multiplier override per RFP (currently global).

## Suggested next enhancement (engagement)
Add a one-click **"Win-rate insights" panel** on the dashboard: for each Client ID, surface average conversion rate, win-rate trend, and predicted CPL based on historical data — turns the tracker into a deal-intelligence tool.
