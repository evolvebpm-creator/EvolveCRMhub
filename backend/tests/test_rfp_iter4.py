"""Backend tests for RFP Master Tracking API - Iteration 4.

Covers:
 - job_seniorities in /reference
 - /rfps/next-ref (with & without date_of_rfp)
 - POST /rfps auto-populates section1.rfp_master_tracking_sheet (server-controlled,
   overwrites client value) - sequential EV_Q_001, EV_Q_002 ...
 - target_job_seniority round-trip persistence
 - PUT /rfps/{id} preserves sequence but refreshes date suffix
 - CSV/XLSX exports include target_job_seniority column
"""
import os
import io
import csv
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

# Load backend env for direct DB access to wipe collection for deterministic seq
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module", autouse=True)
def wipe_db():
    """Ensure deterministic sequence for iter4 tests."""
    c = MongoClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    db.rfps.delete_many({})
    yield
    db.rfps.delete_many({})
    c.close()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def reference(session):
    r = session.get(f"{API}/reference", timeout=30)
    assert r.status_code == 200
    return r.json()


def _rows(reference):
    return [
        {"lead_type": lt, "cpl": 0, "lead_counts": 0, "total_cost": 0}
        for lt in reference["lead_types"]
    ]


def make_payload(reference, date_of_rfp="2026-01-15", job_seniority=None,
                 client_sent_sheet="CLIENT_SENT_SHOULD_BE_IGNORED"):
    return {
        "section1": {
            "rfp_master_tracking_sheet": client_sent_sheet,
            "date_of_rfp": date_of_rfp,
            "campaign_run_date": {"start_date": "2026-02-01", "end_date": "2026-02-28"},
            "client_id": "EVCL001",
            "campaign_name": "TEST_Iter4_Campaign",
            "campaign_id": "TEST-CMP-004",
            "end_client_name": "TEST_Acme4",
            "target_geography": reference["geographies"][:2],
            "target_industries": reference["industries"][:2],
            "revenue_size": reference["revenue_sizes"][:1],
            "employee_size": reference["employee_sizes"][:1],
            "target_job_functions": reference["job_functions"][:1],
            "target_job_titles": ["CTO", "VP Engineering"],
            "target_job_seniority": job_seniority if job_seniority is not None
                                    else ["C-Level (CXO)", "Vice President"],
            "contacts_per_company": 2,
            "exclusions": "",
            "suppression_file": "",
            "campaign_type_config": {"types": ["HQL"], "num_qq": 0, "num_cq": 0, "num_touches": 0},
        },
        "section2": {"data_universe": 0},
        "section3": {
            "data_source": "Apollo",
            "data_counts": 1000,
            "rows": _rows(reference),
            "grand_total_leads": 0,
            "grand_total_cost": 0,
            "blended_cpl": 0,
        },
        "section4": {"rfp_submitted_date": "", "rfp_converted": "N", "volumes_assigned": 0},
    }


class TestReferenceIter4:
    def test_job_seniorities_present(self, reference):
        assert "job_seniorities" in reference
        expected_subset = {
            "Owner", "Partner", "C-Level (CXO)", "Vice President", "Director",
            "Head", "Manager", "Senior", "Individual Contributor", "Entry",
            "Training", "Unpaid",
        }
        assert expected_subset.issubset(set(reference["job_seniorities"]))


class TestNextRef:
    def test_next_ref_no_date(self, session):
        r = session.get(f"{API}/rfps/next-ref", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) >= {"seq", "prefix", "preview"}
        assert d["seq"] == 1  # DB wiped
        assert d["prefix"] == "EV_Q_001"
        # preview uses today's date since no date_of_rfp param
        assert d["preview"].startswith("EV_Q_001_")
        assert len(d["preview"].split("_")[-1]) == 8  # YYYYMMDD

    def test_next_ref_with_date(self, session):
        r = session.get(f"{API}/rfps/next-ref", params={"date_of_rfp": "2026-01-15"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["seq"] == 1
        assert d["preview"] == "EV_Q_001_20260115"


class TestSequentialAutoRef:
    ids = {}

    def test_create_first_is_001(self, session, reference):
        payload = make_payload(reference, date_of_rfp="2026-01-15",
                               client_sent_sheet="SHOULD_BE_OVERWRITTEN")
        r = session.post(f"{API}/rfps", json=payload, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section1"]["rfp_master_tracking_sheet"] == "EV_Q_001_20260115"
        # verify seniority round-trip
        assert data["section1"]["target_job_seniority"] == ["C-Level (CXO)", "Vice President"]
        TestSequentialAutoRef.ids["first"] = data["id"]

    def test_create_second_is_002(self, session, reference):
        payload = make_payload(reference, date_of_rfp="2026-02-20",
                               job_seniority=["Director", "Manager"])
        r = session.post(f"{API}/rfps", json=payload, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section1"]["rfp_master_tracking_sheet"] == "EV_Q_002_20260220"
        assert data["section1"]["target_job_seniority"] == ["Director", "Manager"]
        TestSequentialAutoRef.ids["second"] = data["id"]

    def test_get_persists_seniority(self, session):
        r = session.get(f"{API}/rfps/{TestSequentialAutoRef.ids['first']}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section1"]["target_job_seniority"] == ["C-Level (CXO)", "Vice President"]
        assert data["section1"]["rfp_master_tracking_sheet"] == "EV_Q_001_20260115"

    def test_update_preserves_seq_refreshes_date(self, session, reference):
        rfp_id = TestSequentialAutoRef.ids["first"]
        # Fetch, mutate date_of_rfp, PUT
        current = session.get(f"{API}/rfps/{rfp_id}", timeout=30).json()
        current["section1"]["date_of_rfp"] = "2026-03-20"
        current["section1"]["target_job_seniority"] = ["Head", "Senior"]
        # Even if client tampers with sheet, backend should ignore & preserve seq
        current["section1"]["rfp_master_tracking_sheet"] = "EV_Q_999_19000101"
        r = session.put(f"{API}/rfps/{rfp_id}", json=current, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section1"]["rfp_master_tracking_sheet"] == "EV_Q_001_20260320"
        assert data["section1"]["target_job_seniority"] == ["Head", "Senior"]

        # Round-trip GET
        g = session.get(f"{API}/rfps/{rfp_id}", timeout=30).json()
        assert g["section1"]["rfp_master_tracking_sheet"] == "EV_Q_001_20260320"
        assert g["section1"]["target_job_seniority"] == ["Head", "Senior"]

    def test_second_rfp_unchanged_after_first_update(self, session):
        g = session.get(f"{API}/rfps/{TestSequentialAutoRef.ids['second']}", timeout=30).json()
        assert g["section1"]["rfp_master_tracking_sheet"] == "EV_Q_002_20260220"


class TestExports:
    def test_csv_includes_seniority_and_auto_ref(self, session):
        r = session.get(f"{API}/rfps/export/csv", timeout=30)
        assert r.status_code == 200
        content = r.content.decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)
        assert len(rows) >= 2
        assert "target_job_seniority" in reader.fieldnames
        # find the first RFP row and validate seniority appears
        vals = [row["target_job_seniority"] for row in rows]
        joined = " | ".join(vals)
        assert "Head" in joined and "Senior" in joined

    def test_xlsx_ok(self, session):
        r = session.get(f"{API}/rfps/export/xlsx", timeout=30)
        assert r.status_code == 200
        assert r.content[:2] == b"PK"
