"""Backend tests for RFP Master Tracking API."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app-from-specs-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


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


def sample_payload(reference):
    geos = reference["geographies"][:2]
    inds = reference["industries"][:3]
    rev = reference["revenue_sizes"][:2]
    emp = reference["employee_sizes"][:2]
    funcs = reference["job_functions"][:2]
    titles = reference["job_titles"][:2]
    return {
        "section1": {
            "rfp_master_tracking_sheet": "TEST_SHEET_01",
            "date_of_rfp": "2026-01-15",
            "campaign_run_date": {"start_date": "2026-02-01", "end_date": "2026-02-28"},
            "client_id": "EVCL001",
            "campaign_name": "TEST_Campaign_Backend",
            "campaign_id": "TEST-CMP-001",
            "end_client_name": "TEST_Acme",
            "target_geography": geos,
            "target_industries": inds,
            "revenue_size": rev,
            "employee_size": emp,
            "target_job_functions": funcs,
            "target_job_titles": titles,
            "contacts_per_company": 3,
            "exclusions": "none",
            "suppression_file": "test@example.com",
            "campaign_type_config": {"type": "MQL", "num_qq": 1, "num_cq": 1, "num_touches": 2},
        },
        "section2": {"data_universe": 0},
        "section3": {
            "rows": [
                {"lead_type": "MQL+1CQ", "cpc": 10, "lead_counts": 100, "cpl": 0, "total_cost": 0},
                {"lead_type": "MQL+2CQ", "cpc": 12, "lead_counts": 50, "cpl": 0, "total_cost": 0},
                {"lead_type": "MQL+3CQ", "cpc": 0, "lead_counts": 0, "cpl": 0, "total_cost": 0},
                {"lead_type": "MQL+1QQ", "cpc": 0, "lead_counts": 0, "cpl": 0, "total_cost": 0},
                {"lead_type": "MQL+2QQ", "cpc": 0, "lead_counts": 0, "cpl": 0, "total_cost": 0},
                {"lead_type": "MQL+3QQ", "cpc": 0, "lead_counts": 0, "cpl": 0, "total_cost": 0},
                {"lead_type": "MQL SINGLE TOUCH", "cpc": 5, "lead_counts": 200, "cpl": 0, "total_cost": 0},
                {"lead_type": "MQL DOUBLE TOUCH", "cpc": 0, "lead_counts": 0, "cpl": 0, "total_cost": 0},
                {"lead_type": "MQL MULTI-TOUCH", "cpc": 0, "lead_counts": 0, "cpl": 0, "total_cost": 0},
                {"lead_type": "HQL", "cpc": 20, "lead_counts": 30, "cpl": 0, "total_cost": 0},
                {"lead_type": "BANT", "cpc": 0, "lead_counts": 0, "cpl": 0, "total_cost": 0},
                {"lead_type": "AG", "cpc": 0, "lead_counts": 0, "cpl": 0, "total_cost": 0},
            ],
            "grand_total_leads": 0,
            "grand_total_cost": 0,
            "blended_cpl": 0,
        },
        "section4": {"rfp_submitted_date": "2026-01-20", "rfp_converted": "N", "volumes_assigned": 0},
    }


# ----- Reference endpoint -----
class TestReference:
    def test_reference_keys(self, reference):
        for k in ["geographies", "industries", "revenue_sizes", "employee_sizes",
                  "job_functions", "job_titles", "campaign_types", "lead_types", "lead_multipliers"]:
            assert k in reference, f"missing {k}"
        assert len(reference["lead_types"]) == 12
        assert reference["lead_multipliers"]["HQL"] == 2.5


# ----- Preview compute -----
class TestPreview:
    def test_preview_universe_and_compute(self, session, reference):
        payload = sample_payload(reference)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section2"]["data_universe"] > 0
        rows = {row["lead_type"]: row for row in data["section3"]["rows"]}
        mults = reference["lead_multipliers"]
        # Check MQL+1CQ: cpc 10 * 1.2 = 12.00, total 12*100 = 1200
        assert rows["MQL+1CQ"]["cpl"] == round(10 * mults["MQL+1CQ"], 2)
        assert rows["MQL+1CQ"]["total_cost"] == round(rows["MQL+1CQ"]["cpl"] * 100, 2)
        # HQL: cpc 20 * 2.5 = 50.00, total 50*30 = 1500
        assert rows["HQL"]["cpl"] == round(20 * mults["HQL"], 2)
        assert rows["HQL"]["total_cost"] == round(rows["HQL"]["cpl"] * 30, 2)
        # grand totals
        expected_total_leads = 100 + 50 + 200 + 30
        assert data["section3"]["grand_total_leads"] == expected_total_leads
        expected_total_cost = sum(r["total_cost"] for r in data["section3"]["rows"])
        assert data["section3"]["grand_total_cost"] == round(expected_total_cost, 2)
        assert data["section3"]["blended_cpl"] == round(expected_total_cost / expected_total_leads, 2)


# ----- CRUD -----
class TestCRUD:
    created_id = None

    def test_create_rfp(self, session, reference):
        payload = sample_payload(reference)
        r = session.post(f"{API}/rfps", json=payload, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "id" in data
        assert data["section2"]["data_universe"] > 0
        assert data["section3"]["grand_total_leads"] > 0
        TestCRUD.created_id = data["id"]

    def test_get_rfp(self, session):
        assert TestCRUD.created_id
        r = session.get(f"{API}/rfps/{TestCRUD.created_id}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == TestCRUD.created_id
        assert data["section1"]["campaign_name"] == "TEST_Campaign_Backend"
        assert "_id" not in data

    def test_list_rfps(self, session):
        r = session.get(f"{API}/rfps", timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert any(x["id"] == TestCRUD.created_id for x in rows)

    def test_list_search(self, session):
        r = session.get(f"{API}/rfps", params={"search": "TEST_Campaign_Backend"}, timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert any(x["id"] == TestCRUD.created_id for x in rows)

    def test_list_filter_pending(self, session):
        r = session.get(f"{API}/rfps", params={"converted": "N"}, timeout=30)
        assert r.status_code == 200
        for x in r.json():
            assert x["section4"]["rfp_converted"] == "N"

    def test_update_rfp(self, session, reference):
        payload = sample_payload(reference)
        payload["section1"]["campaign_name"] = "TEST_Campaign_Updated"
        payload["section4"]["rfp_converted"] = "Y"
        payload["section4"]["volumes_assigned"] = 500
        r = session.put(f"{API}/rfps/{TestCRUD.created_id}", json=payload, timeout=30)
        assert r.status_code == 200
        # verify by GET
        g = session.get(f"{API}/rfps/{TestCRUD.created_id}", timeout=30)
        assert g.status_code == 200
        data = g.json()
        assert data["section1"]["campaign_name"] == "TEST_Campaign_Updated"
        assert data["section4"]["rfp_converted"] == "Y"
        assert data["section4"]["volumes_assigned"] == 500

    def test_stats(self, session):
        r = session.get(f"{API}/rfps/stats", timeout=30)
        assert r.status_code == 200
        s = r.json()
        for k in ["total_rfps", "converted_rfps", "pending_rfps", "conversion_rate",
                  "total_lead_volume", "total_lead_cost", "lead_type_distribution",
                  "monthly_series", "top_clients"]:
            assert k in s
        assert s["total_rfps"] >= 1

    def test_export_csv(self, session):
        r = session.get(f"{API}/rfps/export/csv", timeout=30)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert len(r.content) > 0
        assert b"campaign_name" in r.content or b"rfp_id" in r.content

    def test_export_xlsx(self, session):
        r = session.get(f"{API}/rfps/export/xlsx", timeout=30)
        assert r.status_code == 200
        ctype = r.headers.get("content-type", "")
        assert "spreadsheet" in ctype
        assert len(r.content) > 100
        assert r.content[:2] == b"PK"  # xlsx is zip

    def test_delete_rfp(self, session):
        r = session.delete(f"{API}/rfps/{TestCRUD.created_id}", timeout=30)
        assert r.status_code == 200
        # verify deleted
        g = session.get(f"{API}/rfps/{TestCRUD.created_id}", timeout=30)
        assert g.status_code == 404

    def test_delete_nonexistent(self, session):
        r = session.delete(f"{API}/rfps/nonexistent-id-xyz", timeout=30)
        assert r.status_code == 404

    def test_get_nonexistent(self, session):
        r = session.get(f"{API}/rfps/nonexistent-id-xyz", timeout=30)
        assert r.status_code == 404
