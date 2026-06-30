from fastapi import FastAPI, APIRouter, HTTPException, Query
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

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="RFP Master Tracking API")
api_router = APIRouter(prefix="/api")

# ----------------------- Constants & Reference Data ----------------------- #

LEAD_TYPES = [
    "MQL+1CQ", "MQL+2CQ", "MQL+3CQ",
    "MQL+1QQ", "MQL+2QQ", "MQL+3QQ",
    "MQL SINGLE TOUCH",
    "MQL DOUBLE TOUCH",
    "MQL MULTI-TOUCH",
    "HQL", "BANT", "AG",
]

# Cost multipliers applied to CPC to derive CPL for each lead type.
# Higher complexity = higher multiplier.
LEAD_MULTIPLIERS: Dict[str, float] = {
    "MQL+1CQ": 1.2, "MQL+2CQ": 1.4, "MQL+3CQ": 1.6,
    "MQL+1QQ": 1.5, "MQL+2QQ": 1.8, "MQL+3QQ": 2.2,
    "MQL SINGLE TOUCH": 1.0,
    "MQL DOUBLE TOUCH": 1.3,
    "MQL MULTI-TOUCH": 1.7,
    "HQL": 2.5,
    "BANT": 3.5,
    "AG": 5.0,
}

# Universe estimation reference values (approximate global LinkedIn order-of-magnitude)
GLOBAL_COMPANY_BASE = 60_000_000  # rough global addressable company universe
TOTAL_REGIONS = 7  # 7 continents/regions reference
TOTAL_INDUSTRIES = 25  # rough LinkedIn industry buckets reference

EMPLOYEE_BAND_WEIGHT = {
    "1-10": 0.30, "11-50": 0.25, "51-200": 0.18, "201-500": 0.10,
    "501-1000": 0.07, "1001-5000": 0.05, "5001-10000": 0.03, "10000+": 0.02,
}

REVENUE_BAND_WEIGHT = {
    "<$1M": 0.35, "$1M-$10M": 0.25, "$10M-$50M": 0.15, "$50M-$200M": 0.10,
    "$200M-$1B": 0.08, "$1B-$10B": 0.05, "$10B+": 0.02,
}

# ----------------------- Models ----------------------- #


class CampaignRunDate(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class CampaignTypeConfig(BaseModel):
    type: Optional[str] = None  # e.g. MQL, HQL, BANT, Single touch...
    num_qq: Optional[int] = 0
    num_cq: Optional[int] = 0
    num_touches: Optional[int] = 0


class Section1Discovery(BaseModel):
    rfp_master_tracking_sheet: Optional[str] = None
    date_of_rfp: Optional[str] = None
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
    contacts_per_company: Optional[int] = 1
    exclusions: Optional[str] = None  # free text: company / industry / job functions / job titles
    suppression_file: Optional[str] = None  # company names / email ids
    campaign_type_config: CampaignTypeConfig = Field(default_factory=CampaignTypeConfig)


class Section2Universe(BaseModel):
    data_universe: Optional[float] = 0  # auto-computed estimation


class LeadRow(BaseModel):
    lead_type: str
    cpc: float = 0
    lead_counts: float = 0
    cpl: float = 0  # auto: cpc * multiplier
    total_cost: float = 0  # auto: cpl * lead_counts


class Section3Computation(BaseModel):
    rows: List[LeadRow] = Field(default_factory=list)
    grand_total_leads: float = 0
    grand_total_cost: float = 0
    blended_cpl: float = 0


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


def compute_section3(section3: Section3Computation) -> Section3Computation:
    """Auto-fill CPL & totals for every row."""
    total_leads = 0.0
    total_cost = 0.0
    new_rows: List[LeadRow] = []
    for r in section3.rows:
        mult = LEAD_MULTIPLIERS.get(r.lead_type, 1.0)
        cpl = round(float(r.cpc or 0) * mult, 2)
        lc = float(r.lead_counts or 0)
        tcost = round(cpl * lc, 2)
        new_rows.append(
            LeadRow(
                lead_type=r.lead_type,
                cpc=float(r.cpc or 0),
                lead_counts=lc,
                cpl=cpl,
                total_cost=tcost,
            )
        )
        total_leads += lc
        total_cost += tcost
    blended = round(total_cost / total_leads, 2) if total_leads > 0 else 0.0
    return Section3Computation(
        rows=new_rows,
        grand_total_leads=round(total_leads, 2),
        grand_total_cost=round(total_cost, 2),
        blended_cpl=blended,
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


def apply_compute(rfp_in: RFPBase) -> RFPBase:
    rfp_in.section2.data_universe = compute_data_universe(rfp_in.section1)
    rfp_in.section3 = compute_section3(rfp_in.section3)
    return rfp_in


# ----------------------- Reference Endpoints ----------------------- #


@api_router.get("/reference")
async def get_reference():
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
        "campaign_types": [
            "MQL", "MQL with CQ", "MQL with QQ", "HQL", "BANT",
            "Appointment-setup", "Social Media Spend",
            "Single touch", "Double touch", "Multi touch",
        ],
        "lead_types": LEAD_TYPES,
        "lead_multipliers": LEAD_MULTIPLIERS,
    }


# ----------------------- CRUD Endpoints ----------------------- #


@api_router.get("/")
async def root():
    return {"message": "RFP Master Tracking API"}


@api_router.post("/rfps", response_model=RFP)
async def create_rfp(payload: RFPCreate):
    payload = apply_compute(payload)
    rfp = RFP(**payload.model_dump())
    await db.rfps.insert_one(rfp_to_doc(rfp))
    return rfp


@api_router.get("/rfps")
async def list_rfps(
    converted: Optional[str] = Query(default=None),
    client_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
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
async def get_stats():
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
    }


# ---- Export endpoints (must precede /rfps/{rfp_id}) ---- #


def _flat_row(d: dict) -> dict:
    s1 = d.get("section1") or {}
    s2 = d.get("section2") or {}
    s3 = d.get("section3") or {}
    s4 = d.get("section4") or {}
    crd = s1.get("campaign_run_date") or {}
    ctc = s1.get("campaign_type_config") or {}
    return {
        "rfp_id": d.get("id"),
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
        "contacts_per_company": s1.get("contacts_per_company", 1),
        "exclusions": s1.get("exclusions", ""),
        "suppression_file": s1.get("suppression_file", ""),
        "campaign_type": ctc.get("type", ""),
        "num_qq": ctc.get("num_qq", 0),
        "num_cq": ctc.get("num_cq", 0),
        "num_touches": ctc.get("num_touches", 0),
        "data_universe": s2.get("data_universe", 0),
        "grand_total_leads": s3.get("grand_total_leads", 0),
        "grand_total_cost": s3.get("grand_total_cost", 0),
        "blended_cpl": s3.get("blended_cpl", 0),
        "rfp_submitted_date": s4.get("rfp_submitted_date", ""),
        "rfp_converted": s4.get("rfp_converted", "N"),
        "volumes_assigned": s4.get("volumes_assigned", 0),
        "created_at": d.get("created_at", ""),
    }


@api_router.get("/rfps/export/csv")
async def export_csv():
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
async def export_xlsx():
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
        "lead_type", "cpc", "lead_counts", "cpl", "total_cost",
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
                lr.get("cpc"),
                lr.get("lead_counts"),
                lr.get("cpl"),
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
async def get_rfp(rfp_id: str):
    doc = await db.rfps.find_one({"id": rfp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="RFP not found")
    return serialize_rfp(doc)


@api_router.put("/rfps/{rfp_id}", response_model=RFP)
async def update_rfp(rfp_id: str, payload: RFPUpdate):
    existing = await db.rfps.find_one({"id": rfp_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="RFP not found")
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
async def delete_rfp(rfp_id: str):
    res = await db.rfps.delete_one({"id": rfp_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="RFP not found")
    return {"ok": True, "deleted_id": rfp_id}


@api_router.post("/rfps/preview")
async def preview_compute(payload: RFPCreate):
    """Auto-compute Section 2 + Section 3 without saving. Used by the UI."""
    payload = apply_compute(payload)
    return {
        "section2": payload.section2.model_dump(),
        "section3": payload.section3.model_dump(),
    }


# ----------------------- App wiring ----------------------- #

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
