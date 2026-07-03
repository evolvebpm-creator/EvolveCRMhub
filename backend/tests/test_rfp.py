"""Backend tests for RFP Master Tracking API (Iteration 3 — multi-select campaign types + CPL direct input)."""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
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


def _rows(reference, cpl_map=None):
    cpl_map = cpl_map or {}
    return [
        {"lead_type": lt, "cpl": cpl_map.get(lt, 0), "lead_counts": 0, "total_cost": 0}
        for lt in reference["lead_types"]
    ]


def sample_payload(reference, types=None, data_source="Apollo", data_counts=10000,
                   cpl_map=None, num_cq=0, num_qq=0, job_titles=None):
    return {
        "section1": {
            "rfp_master_tracking_sheet": "TEST_SHEET_ITER3",
            "date_of_rfp": "2026-01-15",
            "campaign_run_date": {"start_date": "2026-02-01", "end_date": "2026-02-28"},
            "client_id": "EVCL001",
            "campaign_name": "TEST_Iter3_Campaign",
            "campaign_id": "TEST-CMP-003",
            "end_client_name": "TEST_Acme3",
            "target_geography": reference["geographies"][:2],
            "target_industries": reference["industries"][:2],
            "revenue_size": reference["revenue_sizes"][:1],
            "employee_size": reference["employee_sizes"][:1],
            "target_job_functions": reference["job_functions"][:1],
            "target_job_titles": job_titles if job_titles is not None else ["CEO", "CTO"],
            "contacts_per_company": 2,
            "exclusions": "none",
            "suppression_file": "",
            "campaign_type_config": {
                "types": types if types is not None else [],
                "num_qq": num_qq,
                "num_cq": num_cq,
                "num_touches": 0,
            },
        },
        "section2": {"data_universe": 0},
        "section3": {
            "data_source": data_source,
            "data_counts": data_counts,
            "rows": _rows(reference, cpl_map=cpl_map),
            "grand_total_leads": 0,
            "grand_total_cost": 0,
            "blended_cpl": 0,
        },
        "section4": {"rfp_submitted_date": "", "rfp_converted": "N", "volumes_assigned": 0},
    }


# ----- Reference endpoint -----
class TestReference:
    def test_reference_keys(self, reference):
        for k in ["geographies", "industries", "revenue_sizes", "employee_sizes",
                  "job_functions", "job_titles", "campaign_types", "lead_types",
                  "lead_multipliers", "data_sources", "conversion_rates"]:
            assert k in reference, f"missing {k}"
        assert len(reference["lead_types"]) == 12

    def test_data_sources(self, reference):
        assert reference["data_sources"] == ["LinkedIn", "Prospeo", "Apollo", "VibeProspect"]


# ----- Preview compute: targeted lead types only -----
class TestPreviewTargeting:
    def test_hql_bant_apollo(self, session, reference):
        cpl_map = {"HQL": 25, "BANT": 50, "AG": 999, "MQL SINGLE TOUCH": 999}
        payload = sample_payload(reference, types=["HQL", "BANT"],
                                 data_source="Apollo", data_counts=10000, cpl_map=cpl_map)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        assert r.status_code == 200
        s3 = r.json()["section3"]
        rows = {row["lead_type"]: row for row in s3["rows"]}
        assert rows["HQL"]["lead_counts"] == 1500
        assert rows["HQL"]["total_cost"] == 25 * 1500
        assert rows["BANT"]["lead_counts"] == 500
        assert rows["BANT"]["total_cost"] == 50 * 500
        # non-targeted rows must have lead_counts=0 and total_cost=0 despite cpl set
        assert rows["AG"]["lead_counts"] == 0
        assert rows["AG"]["total_cost"] == 0
        assert rows["MQL SINGLE TOUCH"]["lead_counts"] == 0
        assert rows["MQL SINGLE TOUCH"]["total_cost"] == 0
        assert s3["grand_total_leads"] == 2000
        assert s3["grand_total_cost"] == 62500
        assert s3["blended_cpl"] == 31.25

    def test_mql_with_cq_num_2(self, session, reference):
        payload = sample_payload(reference, types=["MQL with CQ"], num_cq=2,
                                 data_source="VibeProspect", data_counts=1000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["MQL+2CQ"]["lead_counts"] == 450
        assert rows["MQL+1CQ"]["lead_counts"] == 0
        assert rows["MQL+3CQ"]["lead_counts"] == 0

    def test_mql_with_cq_num_zero_fallback(self, session, reference):
        payload = sample_payload(reference, types=["MQL with CQ"], num_cq=0,
                                 data_source="Apollo", data_counts=1000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["MQL+1CQ"]["lead_counts"] == 250
        assert rows["MQL+2CQ"]["lead_counts"] == 250
        assert rows["MQL+3CQ"]["lead_counts"] == 250

    def test_touches_multi_hql_prospeo(self, session, reference):
        payload = sample_payload(reference, types=["Single touch", "Multi touch", "HQL"],
                                 data_source="Prospeo", data_counts=1000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["MQL SINGLE TOUCH"]["lead_counts"] == 350
        assert rows["MQL MULTI-TOUCH"]["lead_counts"] == 250
        assert rows["HQL"]["lead_counts"] == 200
        assert rows["MQL DOUBLE TOUCH"]["lead_counts"] == 0
        assert rows["BANT"]["lead_counts"] == 0
        assert rows["AG"]["lead_counts"] == 0

    def test_empty_types(self, session, reference):
        payload = sample_payload(reference, types=[], data_source="Apollo", data_counts=1000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        for row in r.json()["section3"]["rows"]:
            assert row["lead_counts"] == 0

    def test_social_media_spend_only(self, session, reference):
        payload = sample_payload(reference, types=["Social Media Spend"],
                                 data_source="Apollo", data_counts=1000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        for row in r.json()["section3"]["rows"]:
            assert row["lead_counts"] == 0

    def test_no_cpc_field_in_response(self, session, reference):
        payload = sample_payload(reference, types=["HQL"], data_source="Apollo",
                                 data_counts=1000, cpl_map={"HQL": 25})
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        for row in r.json()["section3"]["rows"]:
            assert "cpc" not in row
            assert set(row.keys()) == {"lead_type", "cpl", "lead_counts", "total_cost"}


# ----- CRUD + persistence -----
class TestCRUD:
    created_id = None

    def test_create_persists_types_and_job_titles(self, session, reference):
        titles = ["Chief Executive Officer", "VP Engineering", "Head of Marketing", "CTO"]
        payload = sample_payload(reference, types=["HQL", "BANT"],
                                 data_source="Apollo", data_counts=10000,
                                 cpl_map={"HQL": 25, "BANT": 50},
                                 job_titles=titles)
        r = session.post(f"{API}/rfps", json=payload, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section1"]["campaign_type_config"]["types"] == ["HQL", "BANT"]
        assert data["section1"]["target_job_titles"] == titles
        rows = {row["lead_type"]: row for row in data["section3"]["rows"]}
        assert rows["HQL"]["lead_counts"] == 1500
        assert rows["HQL"]["total_cost"] == 37500
        assert rows["BANT"]["lead_counts"] == 500
        assert rows["BANT"]["total_cost"] == 25000
        assert data["section3"]["grand_total_leads"] == 2000
        assert data["section3"]["grand_total_cost"] == 62500
        assert data["section3"]["blended_cpl"] == 31.25
        TestCRUD.created_id = data["id"]

    def test_get_roundtrip(self, session):
        r = session.get(f"{API}/rfps/{TestCRUD.created_id}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section1"]["campaign_type_config"]["types"] == ["HQL", "BANT"]
        assert len(data["section1"]["target_job_titles"]) == 4
        assert "_id" not in data
        for row in data["section3"]["rows"]:
            assert "cpc" not in row

    def test_export_csv_new_columns_no_cpc(self, session):
        r = session.get(f"{API}/rfps/export/csv", timeout=30)
        assert r.status_code == 200
        content = r.content.decode("utf-8")
        header = content.splitlines()[0]
        cols = header.split(",")
        assert "cpc" not in cols
        assert "campaign_type" in cols
        assert "data_source" in cols
        assert "data_counts" in cols

    def test_export_xlsx(self, session):
        r = session.get(f"{API}/rfps/export/xlsx", timeout=30)
        assert r.status_code == 200
        assert r.content[:2] == b"PK"

    def test_stats(self, session):
        r = session.get(f"{API}/rfps/stats", timeout=30)
        assert r.status_code == 200
        s = r.json()
        for k in ["total_rfps", "converted_rfps", "pending_rfps", "conversion_rate",
                  "total_lead_volume", "total_lead_cost", "lead_type_distribution",
                  "monthly_series", "top_clients"]:
            assert k in s

    def test_delete(self, session):
        r = session.delete(f"{API}/rfps/{TestCRUD.created_id}", timeout=30)
        assert r.status_code == 200
        g = session.get(f"{API}/rfps/{TestCRUD.created_id}", timeout=30)
        assert g.status_code == 404
