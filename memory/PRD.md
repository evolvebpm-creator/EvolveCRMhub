# RFP Master Tracking — PRD

## Original problem statement
Build an RFP Master Tracking app per attached spec (4 sections: Discovery, Data Universe, Lead Computation, Status). Iterative refinements from user chat.

## User choices
- Single form, single-tenant, no auth
- Auto-compute Sections 2 & 3
- CSV + Excel export + Dashboard with charts
- Design chosen by design agent → "Editorial Terminal / Old Money Tech" (Cormorant Garamond + IBM Plex Mono)

## Architecture
- **Backend**: FastAPI + Motor + MongoDB (collection `rfps`). Endpoints under `/api/`. All computation server-side; UI previews via debounced `POST /api/rfps/preview`.
- **Frontend**: React 19 + Tailwind + Recharts.
- **Tabs**: `[01 / Dashboard]`, `[02 / RFP Tracker]`, `[03 / All RFPs]`.

## Section 3 lead-volume formula (current, iter 5)

For each ACTIVE lead-type row (a row matching the Campaign Types selected in Section 1):

```
base   = Data Universe  ×  Conversion% [source][lead_type] / 100
÷ CPC  = base  /  CPC_DIVISORS[contacts_per_company]
× CQ   = value ×  (1 − CQ_REDUCTIONS[num_cq])
× QQ   = value ×  (1 − QQ_REDUCTIONS[num_qq])
× TV   = value ×  (1 − 0.10)  if with_tv else value
lead_counts = round(value, 0)
total_cost  = round(cpl × lead_counts, 2)
```

### Conversion-rate matrix (% of Data Universe)

| Lead Type | VibeProspect | Prospeo | Apollo | Others |
|---|---:|---:|---:|---:|
| MQL | 45 | 35 | 25 | 15 |
| HQL | 25 | 20 | 15 | 10 |
| BANT - DIGITAL | 15 | 10 | 10 | 5 |
| BANT - TELE | 10 | 8 | 5 | 3 |
| BANT + | 7.5 | 5 | 3 | 2 |
| APPOINTMENT SET-UP | 5 | 3 | 2 | 1 |

### Modifier tables
- **CPC divisors** (contacts per company → divide by): 1→5, 2→3, 3→2, 4→1.5, 5→1.25
- **CQ reductions** (num_cq → subtract): 1→15%, 2→25%, 3→35%, 4→45%, 5→50%
- **QQ reductions** (num_qq → subtract): 1→25%, 2→35%, 3→45%, 4→50%, 5→60%
- **With TV**: subtract 10%

### Campaign-Type → Lead-Type mapping
- MQL / MQL with CQ / MQL with QQ / Single / Double / Multi touch → `MQL`
- HQL → `HQL`
- BANT - Digital → `BANT - DIGITAL`
- BANT - Tele → `BANT - TELE`
- BANT + → `BANT +`
- Appointment Set-up → `APPOINTMENT SET-UP`
- Social Media Spend / unknown → none

## Endpoints
- `GET /api/reference` — dropdowns + conversion matrix + modifier tables.
- `POST /api/rfps`, `GET /api/rfps`, `GET /api/rfps/{id}`, `PUT /api/rfps/{id}`, `DELETE /api/rfps/{id}`.
- `POST /api/rfps/preview` — recompute Sections 2 & 3 without persisting.
- `GET /api/rfps/next-ref[?date_of_rfp=…]` — sequential auto-ref preview.
- `GET /api/rfps/stats`, `GET /api/rfps/export/csv`, `GET /api/rfps/export/xlsx`.

## Iteration log
- **Iter 1**: 4-section RFP form, filter-based Data Universe, list, dashboard, CSV/XLSX export.
- **Iter 2**: Data Source + Data Counts in Section 3; per-source conversion matrix; race-safe preview merge.
- **Iter 3**: Job Titles paste textarea; Type of Campaign multi-select; Section 3 CPC removed → CPL is direct input; only campaign-type-matching rows compute leads.
- **Iter 4**: Auto-generated Master Ref `EV_Q_{NNN}_{YYYYMMDD}`; Job Seniority separate multi-select.
- **Iter 5 (current)**: NEW lead-type list (6 rows), NEW sources (VibeProspect/Prospeo/Apollo/Others), NEW conversion matrix based on Data Universe, Data Counts removed, Data Universe editable, stacked CPC/CQ/QQ/TV modifiers.
- **Deployed**: `https://app-from-specs-9.emergent.host`.
- **Testing**: 22/22 backend pytest + full Playwright E2E pass (`/app/test_reports/iteration_5.json`, 100%/100%).

## Backlog
- P1: Validate `end_date ≥ start_date`.
- P1: PDF export of single RFP detail.
- P2: Bulk XLSX import; RFP-vs-RFP compare.
- P2: Per-RFP override of conversion-rate matrix (currently global).
- P2: Atomic sequence counter for `next_seq_num()` (currently `count_documents+1`).
- P2: Auth (JWT / Emergent Google) if multi-tenant needed.

## Suggested enhancement
"Scenario Simulator" — a side panel where sales-ops can nudge CPC / CQ / QQ / TV / source sliders without editing the RFP, and instantly see the impact on lead counts and total cost, so quotes can be tuned live during a client call.
