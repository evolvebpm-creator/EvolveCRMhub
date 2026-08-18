# RFP Master Tracking — PRD

## Original Problem Statement
Build an RFP Master Tracking App with a single form and auto-compute logic for lead-generation / sales operations. Auto-compute lead volumes based on Data Universe, Campaign Types, Data Sources, and business modifiers (TAL, CQ, QQ, TV). Generate client-facing, branded PDF proposals comparing 3 variations.

## Core Requirements Delivered
- Single-tenant RFP Master Tracking with dynamic Section 3 auto-compute (stacked formula: Universe × Source% × Country% ÷ CPC × (1−CQ)(1−QQ)(1−TV)).
- Section 00 (TAL vs Whitespace) + Section 01 (Discovery) + Section 02 (Data Universe, per-country) + Section 03 (Deliverables) + Section 04 (Submission).
- Per-country universe input when >1 geography is selected — Section 3 breakdown table shows Leads · CPL · Cost per country per lead type in both the Tracker and the Proposal PDF.
- Per-country CPL override (grid) with fallback to row default; `•` marker on overrides in the proposal table.
- Country attainability multiplier — pre-seeded 40+ geographies; admin-editable table + "add country" prompt + missing-country warning banner on the Tracker & Proposal.
- Admin panel (formula, conversion matrix, CPC/CQ/QQ/TV modifiers, country attainability rates, user management) accessible only to `admin` role.
- Proposal View — 3 variants (A/B/C), demographic overrides, "Changes vs Option A" delta block on B/C, modifiers strip on every card, per-country lead-allocation table, snapshot to PNG + copy to clipboard + print/PDF, preset client logos (Encore, LeadScale, B2BMG, BR) + custom upload.
- Data-source display converted to 3-letter codes (VBP / PRO / APO / OTH) — DB keys unchanged, no migration.
- Job Titles input is comma-separated.
- Auth + RBAC — JWT (httpOnly cookies), roles viewer/editor/admin, admin-invite-only registration, seeded bootstrap admin, brute-force lockout (X-Forwarded-For based, TTL-purged), change-password flow, must-change-pw banner on first login.

## Roles
| Role | Access |
|------|--------|
| viewer | Dashboard, All RFPs, Proposal view — read-only. |
| editor | Everything above + create/edit/delete RFPs (RFP Tracker tab). |
| admin  | Everything above + Admin tab (formula, country rates, user management). |

## Bootstrap
- `.env`: `ADMIN_EMAIL=admin@evolvebpm.com`, `ADMIN_PASSWORD=EvolveBPM@2026`, `JWT_SECRET`, `FRONTEND_URL`. See `/app/memory/test_credentials.md`.

## Backlog (P1/P2)
- P1: TAL CSV Import on Section 00 (auto-compute match %).
- P1: Recommended-variation ribbon on Proposal.
- P2: Country Groups Editor (ANZ = AU+NZ etc, auto-derive %).
- P2: Bulk country-rate CSV import in Admin.
- P2: Admin audit log for formula/user changes.
- P3: Currency toggle on Proposal (USD/EUR/GBP with live FX).
- P3: Password reset via email (currently admin resets on user's behalf).

## Architecture
- Backend: FastAPI + Motor (async MongoDB). Auth in `/app/backend/auth.py`; core RFP math + endpoints in `/app/backend/server.py`. Formula settings persisted in `db.settings`. Users in `db.users`. Login attempts in `db.login_attempts` (TTL 24h).
- Frontend: React 19 + Tailwind + shadcn. AuthContext gates the entire shell; login/logout flows through httpOnly cookies + `withCredentials: true`. All API errors surface `[API <status>] <METHOD> <full-url>` in console + enriched inline banner.

## Test Coverage
- Backend: 30/30 pytests pass (auth, RBAC, RFP CRUD, formula, country rates, brute-force lockout). See `/app/backend/tests/backend_test.py`.
- Frontend: RBAC end-to-end verified via testing agent iterations 8 & 9.

## Changelog
- 2026-02: Initial MVP with math, form, dashboard, proposal.
- 2026-08 (this session): country attainability, per-country CPL override, per-country lead breakdown on Tracker, 3-letter source codes, comma-separated job titles, PNG snapshot + preset logos, Admin panel (formula + country + users), JWT auth + RBAC, brute-force lockout with XFF-based identifier.
