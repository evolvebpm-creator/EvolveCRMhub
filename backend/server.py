from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import csv
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from auth import (  # noqa: E402
    build_auth_router,
    bootstrap_indexes_and_admin,
    require_user_dep,
    require_role_dep,
)

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="RFP Master Tracking API")
api_router = APIRouter(prefix="/api")

# Auth dependencies bound to this app's DB handle.
require_user = require_user_dep(db)
require_editor = require_role_dep(db, ("editor", "admin"))
require_admin = require_role_dep(db, ("admin",))

# ----------------------- Constants & Reference Data ----------------------- #

# New lead-type row list (Section 3 rows).
LEAD_TYPES = [
    "MQL",
    "HQL",
    "BANT - DIGITAL",
    "BANT - TELE",
    "BANT +",
    "APPOINTMENT SET-UP",
    "WEBINAR REGISTRATIONS",
    "WEBINAR ATTENDEES",
    "LIVE EVENT REGISTRATIONS",
    "LIVE EVENT ATTENDEES",
]

# Universe estimation reference values (heuristic — used only when auto-suggesting
# Section 2 Data Universe; user can override the value in the UI).
GLOBAL_COMPANY_BASE = 60_000_000
TOTAL_REGIONS = 7
TOTAL_INDUSTRIES = 25

EMPLOYEE_BAND_WEIGHT = {
    "1-10": 0.30, "11-50": 0.25, "51-200": 0.18, "201-500": 0.10,
    "501-1000": 0.07, "1001-5000": 0.05, "5001-10000": 0.03, "10000+": 0.02,
}

REVENUE_BAND_WEIGHT = {
    "<$1M": 0.35, "$1M-$10M": 0.25, "$10M-$50M": 0.15, "$50M-$200M": 0.10,
    "$200M-$1B": 0.08, "$1B-$10B": 0.05, "$10B+": 0.02,
}

# Data sources available for Section 3 lead computation.
DATA_SOURCES = ["VibeProspect", "Prospeo", "Apollo", "Others"]
# 3-letter display codes for UI (DB stores the full internal key above).
SOURCE_CODES: Dict[str, str] = {
    "VibeProspect": "VBP",
    "Prospeo": "PRO",
    "Apollo": "APO",
    "Others": "OTH",
}

# Per-source conversion rates (% of Data Universe → leads of each type).
# Webinar/Live-event rates are source-independent (spec supplies fixed rates).
_EVENT_RATES = {
    "WEBINAR REGISTRATIONS": 25,       # data_universe × 25%
    "WEBINAR ATTENDEES": 5,            # webinar_registrations × 20% = universe × 5%
    "LIVE EVENT REGISTRATIONS": 25,    # data_universe × 25%
    "LIVE EVENT ATTENDEES": 3.75,      # live_event_registrations × 15% = universe × 3.75%
}
CONVERSION_RATES: Dict[str, Dict[str, float]] = {
    "VibeProspect": {
        "MQL": 45, "HQL": 25,
        "BANT - DIGITAL": 15, "BANT - TELE": 10, "BANT +": 7.5,
        "APPOINTMENT SET-UP": 5,
        **_EVENT_RATES,
    },
    "Prospeo": {
        "MQL": 35, "HQL": 20,
        "BANT - DIGITAL": 10, "BANT - TELE": 8, "BANT +": 5,
        "APPOINTMENT SET-UP": 3,
        **_EVENT_RATES,
    },
    "Apollo": {
        "MQL": 25, "HQL": 15,
        "BANT - DIGITAL": 10, "BANT - TELE": 5, "BANT +": 3,
        "APPOINTMENT SET-UP": 2,
        **_EVENT_RATES,
    },
    "Others": {
        "MQL": 15, "HQL": 10,
        "BANT - DIGITAL": 5, "BANT - TELE": 3, "BANT +": 2,
        "APPOINTMENT SET-UP": 1,
        **_EVENT_RATES,
    },
}

# CPC (Contacts Per Company) → divide total leads by this factor.
CPC_DIVISORS: Dict[int, float] = {1: 5.0, 2: 3.0, 3: 2.0, 4: 1.5, 5: 1.25}
# Custom Questions (num_cq) → reduce lead counts by this fraction (0-1).
CQ_REDUCTIONS: Dict[int, float] = {1: 0.15, 2: 0.25, 3: 0.35, 4: 0.45, 5: 0.50}
# Qualifying Questions (num_qq) → reduce lead counts by this fraction.
QQ_REDUCTIONS: Dict[int, float] = {1: 0.25, 2: 0.35, 3: 0.45, 4: 0.50, 5: 0.60}
# With TV (Tele Verification) → 10% reduction.
TV_REDUCTION: float = 0.10

# Country attainability multiplier (stored as %, e.g. 85 == 85%). Applied to leads
# per country: leads = universe × source% × country% / 10000 / cpc_divisor × modifiers.
COUNTRY_RATES: Dict[str, float] = {
    "United States": 85,
    "Canada": 85,
    "ANZ": 75,
    "Europe - all countries as per linkedin": 60,
    "Germany": 50,
    "UK": 75,
    "APAC": 65,
    "India": 85,
    "Middle East": 50,
    "LATAM": 50,
    # Extras from the geography multi-select — sensible defaults so
    # existing RFPs don't break; admin can tune.
    "United Kingdom": 75, "France": 60, "Italy": 60, "Spain": 60,
    "Netherlands": 60, "Sweden": 60, "Switzerland": 60,
    "Australia": 75, "New Zealand": 75, "Singapore": 65,
    "Japan": 65, "China": 65,
    "Mexico": 50, "Brazil": 50, "Argentina": 50,
    "UAE": 50, "Saudi Arabia": 50, "Israel": 50,
    "South Africa": 50, "Nigeria": 50, "Kenya": 50, "Egypt": 50,
    "North America": 85, "South America": 50, "Europe": 60,
    "Asia Pacific": 65, "Africa": 50, "Oceania": 75,
}

# Country GROUPS map a region name -> list of member countries. When a group has
# members, its attainability is auto-derived as the average of member country %s
# (falling back to COUNTRY_RATES[group] when the group has no members).
COUNTRY_GROUPS: Dict[str, List[str]] = {
    "ANZ": ["Australia", "New Zealand"],
    "APAC": ["India", "Singapore", "Japan", "China", "Australia", "New Zealand"],
    "LATAM": ["Mexico", "Brazil", "Argentina"],
    "Middle East": ["UAE", "Saudi Arabia", "Israel"],
    "Europe - all countries as per linkedin": [
        "United Kingdom", "Germany", "France", "Italy", "Spain",
        "Netherlands", "Sweden", "Switzerland",
    ],
    "Europe": [
        "United Kingdom", "Germany", "France", "Italy", "Spain",
        "Netherlands", "Sweden", "Switzerland",
    ],
    "North America": ["United States", "Canada", "Mexico"],
    "South America": ["Brazil", "Argentina"],
    "Africa": ["South Africa", "Nigeria", "Kenya", "Egypt"],
    "Oceania": ["Australia", "New Zealand"],
    "Asia Pacific": ["India", "Singapore", "Japan", "China", "Australia", "New Zealand"],
}

# Snapshot of the ORIGINAL hardcoded defaults so the admin panel can reset.
_DEFAULT_CONVERSION_RATES = {k: dict(v) for k, v in CONVERSION_RATES.items()}
_DEFAULT_CPC_DIVISORS = dict(CPC_DIVISORS)
_DEFAULT_CQ_REDUCTIONS = dict(CQ_REDUCTIONS)
_DEFAULT_QQ_REDUCTIONS = dict(QQ_REDUCTIONS)
_DEFAULT_TV_REDUCTION = TV_REDUCTION
_DEFAULT_COUNTRY_RATES = dict(COUNTRY_RATES)
_DEFAULT_COUNTRY_GROUPS = {k: list(v) for k, v in COUNTRY_GROUPS.items()}


def resolve_country_pct(name: str) -> float:
    """Attainability % for a geography. If it's a group with members, return the
    average of member %s (skipping members missing from the rates table); else
    fall back to COUNTRY_RATES[name] or 100 (no reduction)."""
    members = COUNTRY_GROUPS.get(name) or []
    if members:
        vals = [float(COUNTRY_RATES[m]) for m in members if m in COUNTRY_RATES]
        if vals:
            return sum(vals) / len(vals)
    return float(COUNTRY_RATES.get(name, 100.0))


def _apply_formula_overrides(cfg: dict) -> None:
    """Overwrite module-level formula constants with the provided (partial) dict."""
    if not cfg:
        return
    global TV_REDUCTION
    if "conversion_rates" in cfg and isinstance(cfg["conversion_rates"], dict):
        CONVERSION_RATES.clear()
        for src, rates in cfg["conversion_rates"].items():
            CONVERSION_RATES[src] = {lt: float(v) for lt, v in (rates or {}).items()}
    if "cpc_divisors" in cfg and isinstance(cfg["cpc_divisors"], dict):
        CPC_DIVISORS.clear()
        for k, v in cfg["cpc_divisors"].items():
            CPC_DIVISORS[int(k)] = float(v)
    if "cq_reductions" in cfg and isinstance(cfg["cq_reductions"], dict):
        CQ_REDUCTIONS.clear()
        for k, v in cfg["cq_reductions"].items():
            CQ_REDUCTIONS[int(k)] = float(v)
    if "qq_reductions" in cfg and isinstance(cfg["qq_reductions"], dict):
        QQ_REDUCTIONS.clear()
        for k, v in cfg["qq_reductions"].items():
            QQ_REDUCTIONS[int(k)] = float(v)
    if "tv_reduction" in cfg:
        TV_REDUCTION = float(cfg["tv_reduction"])
    if "country_rates" in cfg and isinstance(cfg["country_rates"], dict):
        COUNTRY_RATES.clear()
        for k, v in cfg["country_rates"].items():
            COUNTRY_RATES[str(k)] = float(v)
    if "country_groups" in cfg and isinstance(cfg["country_groups"], dict):
        COUNTRY_GROUPS.clear()
        for k, v in cfg["country_groups"].items():
            COUNTRY_GROUPS[str(k)] = [str(m) for m in (v or [])]

# Per-source conversion rates block is defined above; nothing to add here.


def campaign_to_lead_types(cfg) -> List[str]:
    """Map Section 1 Campaign Types (multi-select) → Section 3 lead-type row(s)
    that should be populated. Unselected rows stay 0.
    """
    if cfg is None:
        return []
    types = list(getattr(cfg, "types", None) or [])
    result: List[str] = []
    for t in types:
        t = (t or "").strip()
        # All MQL-flavour campaigns collapse to the single MQL row (num_cq / num_qq
        # are now applied as reductions to the calculated lead volume, not as row keys).
        if t in ("MQL", "MQL with CQ", "MQL with QQ",
                 "Single touch", "Double touch", "Multi touch"):
            result.append("MQL")
        elif t == "HQL":
            result.append("HQL")
        elif t in ("BANT - Digital", "BANT - DIGITAL"):
            result.append("BANT - DIGITAL")
        elif t in ("BANT - Tele", "BANT - TELE"):
            result.append("BANT - TELE")
        elif t in ("BANT +", "BANT+", "BANT Plus"):
            result.append("BANT +")
        elif t == "BANT":  # legacy generic → expand to all three BANT variants
            result.extend(["BANT - DIGITAL", "BANT - TELE", "BANT +"])
        elif t in ("Appointment Set-up", "Appointment-setup", "APPOINTMENT SET-UP"):
            result.append("APPOINTMENT SET-UP")
        elif t == "Webinar Registrations":
            result.append("WEBINAR REGISTRATIONS")
        elif t == "Webinar Attendees":
            result.append("WEBINAR ATTENDEES")
        elif t == "LIVE Event Registrations":
            result.append("LIVE EVENT REGISTRATIONS")
        elif t == "LIVE Event Attendees":
            result.append("LIVE EVENT ATTENDEES")
        # "Social Media Spend" and unknown → no lead-type mapping
    # dedupe preserving order
    seen = set()
    out = []
    for x in result:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out

# ----------------------- Models ----------------------- #


class CampaignRunDate(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class CampaignTypeConfig(BaseModel):
    types: List[str] = Field(default_factory=list)  # multi-select
    num_qq: Optional[int] = 0
    num_cq: Optional[int] = 0
    num_touches: Optional[int] = 0
    with_tv: bool = False  # Tele-Verification toggle (10% reduction)


class TALDetails(BaseModel):
    total_count: float = 0
    valid_domain_count: float = 0
    match_count: float = 0
    match_pct: float = 0  # auto: match_count / total_count × 100


class RFPScope(BaseModel):
    type: Optional[str] = ""  # "TAL" or "Whitespace"
    tal: TALDetails = Field(default_factory=TALDetails)


class Section1Discovery(BaseModel):
    rfp_master_tracking_sheet: Optional[str] = None
    date_of_rfp: Optional[str] = None
    scope: RFPScope = Field(default_factory=RFPScope)
    campaign_run_date: CampaignRunDate = Field(default_factory=CampaignRunDate)
    client_id: Optional[str] = None  # EVCL001 to EVCL0100
    campaign_name: Optional[str] = None
    campaign_id: Optional[str] = None
    end_client_name: Optional[str] = None
    target_geography: List[str] = Field(default_factory=list)
    target_industries: List[str] = Field(default_factory=list)
    revenue_size: List[str] = Field(default_factory=list)
    employee_size: List[str] = Field(default_factory=list)
    target_job_functions: List[str] = Field(default_factory=list)
    target_job_titles: List[str] = Field(default_factory=list)
    target_job_seniority: List[str] = Field(default_factory=list)
    contacts_per_company: Optional[int] = 1
    exclusions: Optional[str] = None  # free text: company / industry / job functions / job titles
    suppression_file: Optional[str] = None  # company names / email ids
    campaign_type_config: CampaignTypeConfig = Field(default_factory=CampaignTypeConfig)


class Section2Universe(BaseModel):
    data_universe: Optional[float] = 0  # auto-computed estimation
    universe_by_country: Optional[Dict[str, float]] = None  # per-geography split


class LeadRow(BaseModel):
    lead_type: str
    cpl: float = 0  # user-entered cost per lead (numerical)
    lead_counts: float = 0  # auto-computed from data_source + data_counts + campaign type
    total_cost: float = 0  # auto: cpl * lead_counts


class Section3Computation(BaseModel):
    data_source: Optional[str] = None  # VibeProspect / Prospeo / Apollo / Others
    rows: List[LeadRow] = Field(default_factory=list)
    grand_total_leads: float = 0
    grand_total_cost: float = 0
    blended_cpl: float = 0
    # Optional per-country breakdown: { country: { lead_type: lead_counts } }
    by_country: Optional[Dict[str, Dict[str, float]]] = None
    # Optional per-country CPL override map (input): { country: { lead_type: cpl } }
    cpl_by_country: Optional[Dict[str, Dict[str, float]]] = None
    # Per-country cost breakdown (output): { country: { lead_type: cost } }
    cost_by_country: Optional[Dict[str, Dict[str, float]]] = None
    # Countries selected on the RFP that are missing from COUNTRY_RATES table.
    missing_country_rates: Optional[List[str]] = None


class Section4Status(BaseModel):
    rfp_submitted_date: Optional[str] = None
    rfp_converted: Optional[str] = "N"  # Y / N
    volumes_assigned: Optional[float] = 0


class RFPBase(BaseModel):
    model_config = ConfigDict(extra="ignore")
    section1: Section1Discovery = Field(default_factory=Section1Discovery)
    section2: Section2Universe = Field(default_factory=Section2Universe)
    section3: Section3Computation = Field(default_factory=Section3Computation)
    section4: Section4Status = Field(default_factory=Section4Status)


class RFP(RFPBase):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RFPCreate(RFPBase):
    pass


class RFPUpdate(RFPBase):
    pass


# ----------------------- Helpers ----------------------- #


def compute_data_universe(section1: Section1Discovery) -> float:
    """Heuristic estimate based on filters."""
    geo = section1.target_geography or []
    industries = section1.target_industries or []
    employees = section1.employee_size or []
    revenues = section1.revenue_size or []
    contacts_per_company = max(1, int(section1.contacts_per_company or 1))

    # If no filters are selected, treat universe as 0 (spec: estimation derives from filters).
    if not (geo or industries or employees or revenues):
        return 0.0

    geo_factor = min(1.0, max(0.05, len(geo) / TOTAL_REGIONS)) if geo else 1.0
    industry_factor = (
        min(1.0, max(0.04, len(industries) / TOTAL_INDUSTRIES)) if industries else 1.0
    )
    employee_factor = sum(EMPLOYEE_BAND_WEIGHT.get(b, 0) for b in employees) or 1.0
    revenue_factor = sum(REVENUE_BAND_WEIGHT.get(b, 0) for b in revenues) or 1.0

    companies = (
        GLOBAL_COMPANY_BASE * geo_factor * industry_factor * employee_factor * revenue_factor
    )
    universe = companies * contacts_per_company
    return float(round(universe))


def compute_section3(
    section3: Section3Computation,
    section1: Optional[Section1Discovery] = None,
    data_universe: float = 0.0,
    universe_by_country: Optional[Dict[str, float]] = None,
) -> Section3Computation:
    """Auto-fill lead counts for the lead-type rows that match the Campaign Types
    selected in Section 1, using this stacked formula:

        base    = data_universe × conversion_rate[source][lead_type] / 100
        (÷ CPC) leads = base / cpc_divisor[contacts_per_company]
        (× CQ)  leads = leads × (1 − cq_reduction[num_cq])
        (× QQ)  leads = leads × (1 − qq_reduction[num_qq])
        (× TV)  leads = leads × (1 − 0.10) if with_tv else leads
        lead_counts = round(leads, 0)
        total_cost  = round(cpl × lead_counts, 2)

    CPL is user-entered (numeric). Non-targeted rows stay 0 even if a CPL was typed.
    When a per-country universe map is supplied, also emit a `by_country` map so
    proposals can display the geographic allocation.
    """
    source = section3.data_source if section3.data_source in CONVERSION_RATES else None
    universe = float(data_universe or 0)
    rate_map = CONVERSION_RATES.get(source, {}) if source else {}

    targeted: set = set()
    cpc_val = 0
    n_cq = 0
    n_qq = 0
    with_tv = False
    if section1 is not None:
        targeted = set(campaign_to_lead_types(section1.campaign_type_config))
        cpc_val = int(section1.contacts_per_company or 0)
        cfg = section1.campaign_type_config
        if cfg is not None:
            n_cq = int(cfg.num_cq or 0)
            n_qq = int(cfg.num_qq or 0)
            with_tv = bool(cfg.with_tv)

    cpc_divisor = CPC_DIVISORS.get(cpc_val, 1.0)
    cq_reduction = CQ_REDUCTIONS.get(n_cq, 0.0)
    qq_reduction = QQ_REDUCTIONS.get(n_qq, 0.0)

    def _leads_for(univ: float, lead_type: str, country: Optional[str] = None) -> float:
        if not (lead_type in targeted and source and univ > 0):
            return 0.0
        pct = float(rate_map.get(lead_type, 0))
        base = univ * pct / 100.0
        # Country attainability multiplier (default 100% if country not in table).
        # For a group with members, the % is the AVERAGE of member country %s.
        if country:
            country_pct = resolve_country_pct(country)
            base = base * (country_pct / 100.0)
        leads = base / cpc_divisor
        if lead_type == "MQL":
            leads = leads * (1.0 - cq_reduction)
            leads = leads * (1.0 - qq_reduction)
            if with_tv:
                leads = leads * (1.0 - TV_REDUCTION)
        return leads

    # Determine "the country" for the single-universe path: only when exactly ONE
    # geography is selected can we apply a single country attainability multiplier.
    single_country: Optional[str] = None
    if section1 and section1.target_geography and len(section1.target_geography) == 1:
        single_country = section1.target_geography[0]

    total_leads = 0.0
    total_cost = 0.0
    new_rows: List[LeadRow] = []
    cpl_map = section3.cpl_by_country or {}
    has_split = bool(universe_by_country)
    has_country_cpl = bool(cpl_map) and has_split

    for r in section3.rows:
        cpl_default = float(r.cpl or 0)
        if has_split:
            # Sum leads AND cost per country using per-country CPL when supplied.
            row_leads = 0.0
            row_cost = 0.0
            for country, univ in universe_by_country.items():
                lc_c = round(_leads_for(float(univ or 0), r.lead_type, country), 0)
                if has_country_cpl:
                    cpl_c = float((cpl_map.get(country) or {}).get(r.lead_type) or cpl_default)
                else:
                    cpl_c = cpl_default
                row_leads += lc_c
                row_cost += lc_c * cpl_c
            lc = round(row_leads, 0)
            tcost = round(row_cost, 2)
        else:
            lc = round(_leads_for(universe, r.lead_type, single_country), 0)
            tcost = round(cpl_default * lc, 2)
        new_rows.append(
            LeadRow(
                lead_type=r.lead_type,
                cpl=cpl_default,
                lead_counts=lc,
                total_cost=tcost,
            )
        )
        total_leads += lc
        total_cost += tcost
    blended = round(total_cost / total_leads, 2) if total_leads > 0 else 0.0

    # Per-country breakdown (only when a split universe was provided).
    by_country_out: Optional[Dict[str, Dict[str, float]]] = None
    cost_by_country_out: Optional[Dict[str, Dict[str, float]]] = None
    if has_split:
        by_country_out = {}
        cost_by_country_out = {}
        for country, univ in universe_by_country.items():
            leads_row: Dict[str, float] = {}
            cost_row: Dict[str, float] = {}
            for r in section3.rows:
                lc_c = round(_leads_for(float(univ or 0), r.lead_type, country), 0)
                cpl_c = float((cpl_map.get(country) or {}).get(r.lead_type)
                              or (r.cpl or 0)) if has_country_cpl else float(r.cpl or 0)
                leads_row[r.lead_type] = lc_c
                cost_row[r.lead_type] = round(lc_c * cpl_c, 2)
            by_country_out[country] = leads_row
            cost_by_country_out[country] = cost_row

    # Detect any selected geographies missing from COUNTRY_RATES (excluding regions
    # that already exist in the table).
    missing: List[str] = []
    if section1 and section1.target_geography:
        for g in section1.target_geography:
            if g not in COUNTRY_RATES:
                missing.append(g)

    return Section3Computation(
        data_source=section3.data_source,
        rows=new_rows,
        grand_total_leads=round(total_leads, 2),
        grand_total_cost=round(total_cost, 2),
        blended_cpl=blended,
        by_country=by_country_out,
        cpl_by_country=(cpl_map or None) if has_country_cpl else None,
        cost_by_country=cost_by_country_out,
        missing_country_rates=missing or None,
    )


def serialize_rfp(doc: dict) -> dict:
    """Strip _id, normalize datetimes for JSON."""
    if not doc:
        return doc
    doc.pop("_id", None)
    for k in ("created_at", "updated_at"):
        if isinstance(doc.get(k), datetime):
            doc[k] = doc[k].isoformat()
    return doc


def rfp_to_doc(rfp: RFP) -> dict:
    d = rfp.model_dump()
    d["created_at"] = rfp.created_at.isoformat()
    d["updated_at"] = rfp.updated_at.isoformat()
    return d


def compute_scope(scope: RFPScope) -> RFPScope:
    """Auto-compute TAL match % when scope=TAL."""
    tal = scope.tal
    total = float(tal.total_count or 0)
    matched = float(tal.match_count or 0)
    pct = round((matched / total) * 100.0, 2) if total > 0 else 0.0
    return RFPScope(type=scope.type, tal=TALDetails(
        total_count=total,
        valid_domain_count=float(tal.valid_domain_count or 0),
        match_count=matched,
        match_pct=pct,
    ))


def apply_compute(rfp_in: RFPBase) -> RFPBase:
    # Data Universe: when the user has provided a per-country split, the total
    # universe is the SUM of those buckets; otherwise treat data_universe as a
    # single manual input.
    by_country = rfp_in.section2.universe_by_country or {}
    if by_country:
        universe = float(sum((v or 0) for v in by_country.values()))
        rfp_in.section2.data_universe = universe
    else:
        universe = float(rfp_in.section2.data_universe or 0)
        rfp_in.section2.data_universe = universe
    # Auto-compute Scope's TAL match %.
    rfp_in.section1.scope = compute_scope(rfp_in.section1.scope)
    rfp_in.section3 = compute_section3(
        rfp_in.section3, rfp_in.section1,
        data_universe=universe,
        universe_by_country=by_country,
    )
    return rfp_in


# ----------------------- Formula Settings (Admin) ----------------------- #

SETTINGS_ID = "formula_config"


async def _load_settings_on_start() -> None:
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0})
    if doc:
        _apply_formula_overrides(doc)


class FormulaConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    conversion_rates: Optional[Dict[str, Dict[str, float]]] = None
    cpc_divisors: Optional[Dict[str, float]] = None  # keys as strings (JSON-friendly)
    cq_reductions: Optional[Dict[str, float]] = None
    qq_reductions: Optional[Dict[str, float]] = None
    tv_reduction: Optional[float] = None
    country_rates: Optional[Dict[str, float]] = None
    country_groups: Optional[Dict[str, List[str]]] = None


def _current_formula() -> dict:
    return {
        "conversion_rates": {k: dict(v) for k, v in CONVERSION_RATES.items()},
        "cpc_divisors": {str(k): v for k, v in CPC_DIVISORS.items()},
        "cq_reductions": {str(k): v for k, v in CQ_REDUCTIONS.items()},
        "qq_reductions": {str(k): v for k, v in QQ_REDUCTIONS.items()},
        "tv_reduction": TV_REDUCTION,
        "country_rates": dict(COUNTRY_RATES),
        "country_groups": {k: list(v) for k, v in COUNTRY_GROUPS.items()},
    }


def _defaults_formula() -> dict:
    return {
        "conversion_rates": {k: dict(v) for k, v in _DEFAULT_CONVERSION_RATES.items()},
        "cpc_divisors": {str(k): v for k, v in _DEFAULT_CPC_DIVISORS.items()},
        "cq_reductions": {str(k): v for k, v in _DEFAULT_CQ_REDUCTIONS.items()},
        "qq_reductions": {str(k): v for k, v in _DEFAULT_QQ_REDUCTIONS.items()},
        "tv_reduction": _DEFAULT_TV_REDUCTION,
        "country_rates": dict(_DEFAULT_COUNTRY_RATES),
        "country_groups": {k: list(v) for k, v in _DEFAULT_COUNTRY_GROUPS.items()},
    }


@api_router.get("/settings/formula")
async def get_formula(_user: dict = Depends(require_user)):
    return {"current": _current_formula(), "defaults": _defaults_formula()}


@api_router.put("/settings/formula")
async def update_formula(payload: FormulaConfig, _admin: dict = Depends(require_admin)):
    body = payload.model_dump(exclude_none=True)
    _apply_formula_overrides(body)
    await db.settings.update_one(
        {"id": SETTINGS_ID},
        {"$set": {**body, "id": SETTINGS_ID, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "current": _current_formula()}


@api_router.post("/settings/formula/reset")
async def reset_formula(_admin: dict = Depends(require_admin)):
    _apply_formula_overrides(_defaults_formula())
    await db.settings.delete_one({"id": SETTINGS_ID})
    return {"ok": True, "current": _current_formula()}


# ----------------------- Reference Endpoints ----------------------- #


@api_router.get("/reference")
async def get_reference(_user: dict = Depends(require_user)):
    """Static reference data for UI dropdowns / multi-selects."""
    return {
        "client_id_range": {"prefix": "EVCL", "start": 1, "end": 100},
        "geographies": [
            "North America", "South America", "Europe", "Middle East",
            "Africa", "Asia Pacific", "Oceania",
            # countries
            "United States", "Canada", "Mexico", "Brazil", "Argentina",
            "United Kingdom", "Germany", "France", "Italy", "Spain",
            "Netherlands", "Sweden", "Switzerland",
            "UAE", "Saudi Arabia", "Israel",
            "South Africa", "Nigeria", "Kenya", "Egypt",
            "India", "China", "Japan", "Singapore", "Australia", "New Zealand",
        ],
        "industries": [
            "Information Technology & Services", "Software Development",
            "Financial Services", "Banking", "Insurance", "Healthcare",
            "Pharmaceuticals", "Manufacturing", "Retail", "E-commerce",
            "Telecommunications", "Media & Entertainment", "Education",
            "Government Administration", "Real Estate", "Construction",
            "Transportation & Logistics", "Energy & Utilities", "Oil & Gas",
            "Automotive", "Aerospace & Defense", "Consumer Goods",
            "Hospitality", "Professional Services", "Marketing & Advertising",
        ],
        "revenue_sizes": list(REVENUE_BAND_WEIGHT.keys()),
        "employee_sizes": list(EMPLOYEE_BAND_WEIGHT.keys()),
        "job_functions": [
            "Information Technology", "Engineering", "Operations", "Finance",
            "Accounting", "Marketing", "Sales", "Business Development",
            "Human Resources", "Product Management", "Legal",
            "Research", "Consulting", "Customer Success", "Procurement",
        ],
        "job_titles": [
            "C-Level (CEO, CFO, CTO, CIO, CMO, COO)", "VP", "Director",
            "Head of", "Manager", "Senior Manager", "Lead", "Specialist",
        ],
        "job_seniorities": [
            "Owner", "Partner", "C-Level (CXO)", "Vice President",
            "Director", "Head", "Manager", "Senior",
            "Individual Contributor", "Entry", "Training", "Unpaid",
        ],
        "campaign_types": [
            "MQL", "MQL with CQ", "MQL with QQ",
            "HQL",
            "BANT - Digital", "BANT - Tele", "BANT +",
            "Appointment Set-up",
            "Webinar Registrations", "Webinar Attendees",
            "LIVE Event Registrations", "LIVE Event Attendees",
            "Social Media Spend",
            "Single touch", "Double touch", "Multi touch",
        ],
        "lead_types": LEAD_TYPES,
        "data_sources": DATA_SOURCES,
        "data_sources_labeled": [{"value": s, "code": SOURCE_CODES.get(s, s)} for s in DATA_SOURCES],
        "source_codes": SOURCE_CODES,
        "conversion_rates": CONVERSION_RATES,
        "country_rates": dict(COUNTRY_RATES),
        "country_groups": {k: list(v) for k, v in COUNTRY_GROUPS.items()},
        "cpc_divisors": CPC_DIVISORS,
        "cq_reductions": CQ_REDUCTIONS,
        "qq_reductions": QQ_REDUCTIONS,
        "tv_reduction": TV_REDUCTION,
    }


# ----------------------- CRUD Endpoints ----------------------- #


def format_master_ref(seq: int, date_of_rfp: Optional[str]) -> str:
    """Build the Master Tracking Sheet Ref: EV_Q_{NNN}_{YYYYMMDD}.
    date_of_rfp is the "date of RFP response" (Section 1). If empty, today's date is used.
    """
    date_part = (date_of_rfp or "").replace("-", "").strip()
    if not date_part:
        date_part = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"EV_Q_{seq:03d}_{date_part}"


async def next_seq_num() -> int:
    return int(await db.rfps.count_documents({})) + 1


@api_router.get("/rfps/next-ref")
async def get_next_ref(
    date_of_rfp: Optional[str] = Query(default=None),
    _user: dict = Depends(require_user),
):
    seq = await next_seq_num()
    return {
        "seq": seq,
        "prefix": f"EV_Q_{seq:03d}",
        "preview": format_master_ref(seq, date_of_rfp),
    }


@api_router.get("/")
async def root():
    return {"message": "RFP Master Tracking API"}


@api_router.post("/rfps", response_model=RFP)
async def create_rfp(payload: RFPCreate, _user: dict = Depends(require_editor)):
    # Always auto-populate the Master Tracking Sheet Ref on create.
    seq = await next_seq_num()
    payload.section1.rfp_master_tracking_sheet = format_master_ref(
        seq, payload.section1.date_of_rfp
    )
    payload = apply_compute(payload)
    rfp = RFP(**payload.model_dump())
    await db.rfps.insert_one(rfp_to_doc(rfp))
    return rfp


@api_router.get("/rfps")
async def list_rfps(
    converted: Optional[str] = Query(default=None),
    client_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    _user: dict = Depends(require_user),
):
    query: Dict[str, Any] = {}
    if converted in ("Y", "N"):
        query["section4.rfp_converted"] = converted
    if client_id:
        query["section1.client_id"] = client_id
    if search:
        query["$or"] = [
            {"section1.campaign_name": {"$regex": search, "$options": "i"}},
            {"section1.campaign_id": {"$regex": search, "$options": "i"}},
            {"section1.end_client_name": {"$regex": search, "$options": "i"}},
            {"section1.client_id": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.rfps.find(query).sort("created_at", -1).to_list(1000)
    return [serialize_rfp(d) for d in docs]


@api_router.get("/rfps/stats")
async def get_stats(_user: dict = Depends(require_user)):
    docs = await db.rfps.find({}, {"_id": 0}).to_list(2000)
    total = len(docs)
    converted = sum(1 for d in docs if (d.get("section4") or {}).get("rfp_converted") == "Y")
    pending = total - converted
    total_volume = sum(
        float((d.get("section3") or {}).get("grand_total_leads") or 0) for d in docs
    )
    total_cost = sum(
        float((d.get("section3") or {}).get("grand_total_cost") or 0) for d in docs
    )
    total_volume_assigned = sum(
        float((d.get("section4") or {}).get("volumes_assigned") or 0) for d in docs
    )
    conversion_rate = round((converted / total) * 100, 1) if total > 0 else 0

    # Lead-type distribution across all RFPs
    lead_type_dist: Dict[str, float] = {lt: 0 for lt in LEAD_TYPES}
    for d in docs:
        for row in (d.get("section3") or {}).get("rows", []):
            lt = row.get("lead_type")
            if lt in lead_type_dist:
                lead_type_dist[lt] += float(row.get("lead_counts") or 0)

    # Conversion-by-month for line chart
    monthly: Dict[str, Dict[str, int]] = {}
    for d in docs:
        ts = d.get("created_at")
        if isinstance(ts, str):
            month = ts[:7]
        elif isinstance(ts, datetime):
            month = ts.strftime("%Y-%m")
        else:
            continue
        m = monthly.setdefault(month, {"total": 0, "converted": 0})
        m["total"] += 1
        if (d.get("section4") or {}).get("rfp_converted") == "Y":
            m["converted"] += 1
    monthly_series = [
        {"month": k, "total": v["total"], "converted": v["converted"]}
        for k, v in sorted(monthly.items())
    ]

    # Top clients by lead volume
    by_client: Dict[str, float] = {}
    for d in docs:
        cid = (d.get("section1") or {}).get("client_id") or "—"
        by_client[cid] = by_client.get(cid, 0) + float(
            (d.get("section3") or {}).get("grand_total_leads") or 0
        )
    top_clients = sorted(
        [{"client_id": k, "leads": v} for k, v in by_client.items() if v > 0],
        key=lambda x: x["leads"],
        reverse=True,
    )[:8]

    # TAL match stats (across TAL-scoped RFPs).
    tal_scoped = [
        d for d in docs
        if ((d.get("section1") or {}).get("scope") or {}).get("type") == "TAL"
    ]
    tal_bucket = {"0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0}
    tal_pcts: List[float] = []
    for d in tal_scoped:
        tal = ((d.get("section1") or {}).get("scope") or {}).get("tal") or {}
        pct = float(tal.get("match_pct") or 0)
        tal_pcts.append(pct)
        if pct < 25:
            tal_bucket["0-25%"] += 1
        elif pct < 50:
            tal_bucket["25-50%"] += 1
        elif pct < 75:
            tal_bucket["50-75%"] += 1
        else:
            tal_bucket["75-100%"] += 1
    tal_avg = round(sum(tal_pcts) / len(tal_pcts), 2) if tal_pcts else 0.0

    return {
        "total_rfps": total,
        "converted_rfps": converted,
        "pending_rfps": pending,
        "conversion_rate": conversion_rate,
        "total_lead_volume": round(total_volume, 2),
        "total_lead_cost": round(total_cost, 2),
        "total_volume_assigned": round(total_volume_assigned, 2),
        "lead_type_distribution": [
            {"lead_type": k, "count": v} for k, v in lead_type_dist.items()
        ],
        "monthly_series": monthly_series,
        "top_clients": top_clients,
        "tal_stats": {
            "tal_rfp_count": len(tal_scoped),
            "avg_match_pct": tal_avg,
            "distribution": [
                {"bucket": k, "count": v} for k, v in tal_bucket.items()
            ],
        },
    }


# ---- Export endpoints (must precede /rfps/{rfp_id}) ---- #


def _flat_row(d: dict) -> dict:
    s1 = d.get("section1") or {}
    s2 = d.get("section2") or {}
    s3 = d.get("section3") or {}
    s4 = d.get("section4") or {}
    crd = s1.get("campaign_run_date") or {}
    ctc = s1.get("campaign_type_config") or {}
    scope = s1.get("scope") or {}
    tal = scope.get("tal") or {}
    return {
        "rfp_id": d.get("id"),
        "scope_type": scope.get("type", ""),
        "tal_total": tal.get("total_count", 0),
        "tal_valid_domains": tal.get("valid_domain_count", 0),
        "tal_match_count": tal.get("match_count", 0),
        "tal_match_pct": tal.get("match_pct", 0),
        "date_of_rfp": s1.get("date_of_rfp", ""),
        "campaign_start": crd.get("start_date", ""),
        "campaign_end": crd.get("end_date", ""),
        "client_id": s1.get("client_id", ""),
        "campaign_name": s1.get("campaign_name", ""),
        "campaign_id": s1.get("campaign_id", ""),
        "end_client_name": s1.get("end_client_name", ""),
        "target_geography": ", ".join(s1.get("target_geography") or []),
        "target_industries": ", ".join(s1.get("target_industries") or []),
        "revenue_size": ", ".join(s1.get("revenue_size") or []),
        "employee_size": ", ".join(s1.get("employee_size") or []),
        "target_job_functions": ", ".join(s1.get("target_job_functions") or []),
        "target_job_titles": ", ".join(s1.get("target_job_titles") or []),
        "target_job_seniority": ", ".join(s1.get("target_job_seniority") or []),
        "contacts_per_company": s1.get("contacts_per_company", 1),
        "exclusions": s1.get("exclusions", ""),
        "suppression_file": s1.get("suppression_file", ""),
        "campaign_type": ", ".join(ctc.get("types") or []),
        "num_qq": ctc.get("num_qq", 0),
        "num_cq": ctc.get("num_cq", 0),
        "num_touches": ctc.get("num_touches", 0),
        "with_tv": "Y" if ctc.get("with_tv") else "N",
        "data_universe": s2.get("data_universe", 0),
        "data_source": s3.get("data_source", ""),
        "grand_total_leads": s3.get("grand_total_leads", 0),
        "grand_total_cost": s3.get("grand_total_cost", 0),
        "blended_cpl": s3.get("blended_cpl", 0),
        "rfp_submitted_date": s4.get("rfp_submitted_date", ""),
        "rfp_converted": s4.get("rfp_converted", "N"),
        "volumes_assigned": s4.get("volumes_assigned", 0),
        "created_at": d.get("created_at", ""),
    }


@api_router.get("/rfps/export/csv")
async def export_csv(_user: dict = Depends(require_user)):
    docs = await db.rfps.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    rows = [_flat_row(d) for d in docs]
    buf = io.StringIO()
    if not rows:
        buf.write("No RFPs available\n")
    else:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    data = buf.getvalue().encode("utf-8")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="rfps.csv"'},
    )


@api_router.get("/rfps/export/xlsx")
async def export_xlsx(_user: dict = Depends(require_user)):
    docs = await db.rfps.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    wb = openpyxl.Workbook()

    # Summary sheet
    ws = wb.active
    ws.title = "RFPs"
    rows = [_flat_row(d) for d in docs]
    headers = list(rows[0].keys()) if rows else ["No data"]
    ws.append(headers)
    header_fill = PatternFill("solid", fgColor="0A0A0A")
    header_font = Font(color="FFFFFF", bold=True, name="Consolas")
    for col_idx, _h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="left", vertical="center")
    for r in rows:
        ws.append([r.get(h) for h in headers])

    # Leads detail sheet
    ws2 = wb.create_sheet("Leads Detail")
    lead_headers = [
        "rfp_id", "client_id", "campaign_name",
        "lead_type", "cpl", "lead_counts", "total_cost",
    ]
    ws2.append(lead_headers)
    for col_idx in range(1, len(lead_headers) + 1):
        cell = ws2.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
    for d in docs:
        s3rows = (d.get("section3") or {}).get("rows", [])
        for lr in s3rows:
            ws2.append([
                d.get("id"),
                (d.get("section1") or {}).get("client_id", ""),
                (d.get("section1") or {}).get("campaign_name", ""),
                lr.get("lead_type"),
                lr.get("cpl"),
                lr.get("lead_counts"),
                lr.get("total_cost"),
            ])

    for sheet in (ws, ws2):
        for column_cells in sheet.columns:
            max_len = 0
            for c in column_cells:
                v = "" if c.value is None else str(c.value)
                if len(v) > max_len:
                    max_len = len(v)
            sheet.column_dimensions[column_cells[0].column_letter].width = min(40, max_len + 2)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="rfps.xlsx"'},
    )


@api_router.get("/rfps/{rfp_id}")
async def get_rfp(rfp_id: str, _user: dict = Depends(require_user)):
    doc = await db.rfps.find_one({"id": rfp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="RFP not found")
    return serialize_rfp(doc)


@api_router.put("/rfps/{rfp_id}", response_model=RFP)
async def update_rfp(
    rfp_id: str, payload: RFPUpdate, _user: dict = Depends(require_editor),
):
    existing = await db.rfps.find_one({"id": rfp_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="RFP not found")
    # Keep existing sequence number; refresh date suffix if date_of_rfp changed.
    existing_ref = ((existing.get("section1") or {}).get("rfp_master_tracking_sheet") or "")
    seq = None
    if existing_ref.startswith("EV_Q_"):
        parts = existing_ref.split("_")
        # EV_Q_{NNN}_{YYYYMMDD}
        if len(parts) >= 3 and parts[2].isdigit():
            seq = int(parts[2])
    if seq is None:
        seq = await next_seq_num()
    payload.section1.rfp_master_tracking_sheet = format_master_ref(
        seq, payload.section1.date_of_rfp
    )
    payload = apply_compute(payload)
    updated = RFP(
        id=rfp_id,
        created_at=datetime.fromisoformat(existing["created_at"])
        if isinstance(existing.get("created_at"), str)
        else existing.get("created_at", datetime.now(timezone.utc)),
        updated_at=datetime.now(timezone.utc),
        **payload.model_dump(),
    )
    await db.rfps.replace_one({"id": rfp_id}, rfp_to_doc(updated))
    return updated


@api_router.delete("/rfps/{rfp_id}")
async def delete_rfp(rfp_id: str, _user: dict = Depends(require_editor)):
    res = await db.rfps.delete_one({"id": rfp_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="RFP not found")
    return {"ok": True, "deleted_id": rfp_id}


@api_router.post("/rfps/preview")
async def preview_compute(payload: RFPCreate, _user: dict = Depends(require_user)):
    """Auto-compute Section 2 + Section 3 without saving. Used by the UI."""
    payload = apply_compute(payload)
    return {
        "section2": payload.section2.model_dump(),
        "section3": payload.section3.model_dump(),
    }


# ----------------------- App wiring ----------------------- #

# Auth + user management router mounted on the same /api prefix.
api_router.include_router(build_auth_router(db, require_user, require_admin))

app.include_router(api_router)

# CORS: credentials + explicit origin (browsers reject "*" with credentials).
_frontend_origin = (os.environ.get("FRONTEND_URL") or "").strip()
_extra_cors = [o.strip() for o in (os.environ.get("CORS_ORIGINS") or "").split(",") if o.strip() and o.strip() != "*"]
_allow_origins = [o for o in ([_frontend_origin] + _extra_cors) if o]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_allow_origins or [_frontend_origin],
    allow_origin_regex=r"https://.*\.preview\.emergentagent\.com" if not _allow_origins else None,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup_load_settings():
    try:
        await _load_settings_on_start()
    except Exception as e:
        logger.warning(f"Failed to load formula settings on startup: {e}")
    try:
        await bootstrap_indexes_and_admin(db)
        logger.info("Auth bootstrap complete: indexes ensured, admin seeded.")
    except Exception as e:
        logger.warning(f"Auth bootstrap failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
