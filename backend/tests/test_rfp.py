"""Backend tests for RFP Master Tracking API (Iteration 2 — data_source / data_counts)."""
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


def _rows_for_all_types(reference, cpc_map=None):
    cpc_map = cpc_map or {}
    return [
        {"lead_type": lt, "cpc": cpc_map.get(lt, 0), "lead_counts": 0, "cpl": 0, "total_cost": 0}
        for lt in reference["lead_types"]
    ]


def sample_payload(reference, data_source="Apollo", data_counts=10000, cpc_map=None):
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
            "data_source": data_source,
            "data_counts": data_counts,
            "rows": _rows_for_all_types(reference, cpc_map=cpc_map),
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
                  "job_functions", "job_titles", "campaign_types", "lead_types",
                  "lead_multipliers", "data_sources", "conversion_rates"]:
            assert k in reference, f"missing {k}"
        assert len(reference["lead_types"]) == 12
        assert reference["lead_multipliers"]["HQL"] == 2.5

    def test_data_sources(self, reference):
        assert reference["data_sources"] == ["LinkedIn", "Prospeo", "Apollo", "VibeProspect"]

    def test_conversion_rates_shape(self, reference):
        cr = reference["conversion_rates"]
        for src in ["LinkedIn", "Prospeo", "Apollo", "VibeProspect"]:
            assert src in cr, f"missing {src}"
            for lt in reference["lead_types"]:
                assert lt in cr[src], f"missing {src}/{lt}"

    def test_linkedin_defaults_to_vibeprospect(self, reference):
        cr = reference["conversion_rates"]
        assert cr["LinkedIn"] == cr["VibeProspect"]

    def test_specific_rates_apollo(self, reference):
        a = reference["conversion_rates"]["Apollo"]
        assert a["MQL+1CQ"] == 25
        assert a["MQL+1QQ"] == 20
        assert a["MQL SINGLE TOUCH"] == 25
        assert a["MQL DOUBLE TOUCH"] == 20
        assert a["MQL MULTI-TOUCH"] == 20
        assert a["HQL"] == 15
        assert a["BANT"] == 5
        assert a["AG"] == 3

    def test_specific_rates_vibeprospect(self, reference):
        v = reference["conversion_rates"]["VibeProspect"]
        assert v["MQL+1CQ"] == 45
        assert v["HQL"] == 25
        assert v["BANT"] == 10
        assert v["AG"] == 3

    def test_specific_rates_prospeo(self, reference):
        p = reference["conversion_rates"]["Prospeo"]
        assert p["MQL+1CQ"] == 35
        assert p["HQL"] == 20
        assert p["BANT"] == 5
        assert p["AG"] == 3


# ----- Preview compute: auto lead-counts logic -----
class TestPreviewLeadCounts:
    def test_apollo_10000(self, session, reference):
        payload = sample_payload(reference, "Apollo", 10000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        assert r.status_code == 200
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["MQL+1CQ"]["lead_counts"] == 2500
        assert rows["MQL+1QQ"]["lead_counts"] == 2000
        assert rows["MQL SINGLE TOUCH"]["lead_counts"] == 2500
        assert rows["MQL DOUBLE TOUCH"]["lead_counts"] == 2000
        assert rows["MQL MULTI-TOUCH"]["lead_counts"] == 2000
        assert rows["HQL"]["lead_counts"] == 1500
        assert rows["BANT"]["lead_counts"] == 500
        assert rows["AG"]["lead_counts"] == 300

    def test_vibeprospect_10000(self, session, reference):
        payload = sample_payload(reference, "VibeProspect", 10000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["MQL+1CQ"]["lead_counts"] == 4500
        assert rows["HQL"]["lead_counts"] == 2500
        assert rows["BANT"]["lead_counts"] == 1000
        assert rows["AG"]["lead_counts"] == 300

    def test_linkedin_matches_vibeprospect(self, session, reference):
        payload = sample_payload(reference, "LinkedIn", 10000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["MQL+1CQ"]["lead_counts"] == 4500
        assert rows["HQL"]["lead_counts"] == 2500

    def test_prospeo_1000(self, session, reference):
        payload = sample_payload(reference, "Prospeo", 1000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["MQL+1CQ"]["lead_counts"] == 350
        assert rows["HQL"]["lead_counts"] == 200
        assert rows["BANT"]["lead_counts"] == 50
        assert rows["AG"]["lead_counts"] == 30

    def test_empty_source_yields_zero(self, session, reference):
        payload = sample_payload(reference, "", 10000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = r.json()["section3"]["rows"]
        for row in rows:
            assert row["lead_counts"] == 0

    def test_zero_counts_yields_zero(self, session, reference):
        payload = sample_payload(reference, "Apollo", 0)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = r.json()["section3"]["rows"]
        for row in rows:
            assert row["lead_counts"] == 0


# ----- CPL math + totals (auto leads * cpc multiplier) -----
class TestPreviewCpl:
    def test_apollo_with_cpcs(self, session, reference):
        cpc_map = {"HQL": 10, "AG": 20}
        payload = sample_payload(reference, "Apollo", 10000, cpc_map=cpc_map)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        data = r.json()
        rows = {row["lead_type"]: row for row in data["section3"]["rows"]}
        mults = reference["lead_multipliers"]
        # HQL: lead_counts=1500, cpc=10, cpl=10*2.5=25, total=25*1500=37500
        assert rows["HQL"]["cpl"] == round(10 * mults["HQL"], 2) == 25.0
        assert rows["HQL"]["lead_counts"] == 1500
        assert rows["HQL"]["total_cost"] == 25.0 * 1500
        # AG: lead_counts=300, cpc=20, cpl=20*5=100, total=100*300=30000
        assert rows["AG"]["cpl"] == round(20 * mults["AG"], 2) == 100.0
        assert rows["AG"]["lead_counts"] == 300
        assert rows["AG"]["total_cost"] == 100.0 * 300

    def test_grand_totals(self, session, reference):
        cpc_map = {"HQL": 10, "AG": 20}
        payload = sample_payload(reference, "Apollo", 10000, cpc_map=cpc_map)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        s3 = r.json()["section3"]
        # only HQL and AG have non-zero cost; lead_counts though sum over all rows
        expected_total_cost = 25.0 * 1500 + 100.0 * 300
        assert s3["grand_total_cost"] == round(expected_total_cost, 2)
        expected_total_leads = sum(row["lead_counts"] for row in s3["rows"])
        assert s3["grand_total_leads"] == expected_total_leads
        assert s3["blended_cpl"] == round(expected_total_cost / expected_total_leads, 2)


# ----- CRUD + persistence of data_source/data_counts -----
class TestCRUD:
    created_id = None

    def test_create_persists_section3(self, session, reference):
        payload = sample_payload(reference, "Apollo", 10000, cpc_map={"HQL": 10, "AG": 20})
        r = session.post(f"{API}/rfps", json=payload, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section3"]["data_source"] == "Apollo"
        assert data["section3"]["data_counts"] == 10000
        rows = {row["lead_type"]: row for row in data["section3"]["rows"]}
        assert rows["HQL"]["lead_counts"] == 1500
        assert rows["HQL"]["cpl"] == 25.0
        assert rows["HQL"]["total_cost"] == 37500
        assert rows["AG"]["lead_counts"] == 300
        assert rows["AG"]["cpl"] == 100.0
        assert rows["AG"]["total_cost"] == 30000
        TestCRUD.created_id = data["id"]

    def test_get_roundtrip(self, session):
        r = session.get(f"{API}/rfps/{TestCRUD.created_id}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section3"]["data_source"] == "Apollo"
        assert data["section3"]["data_counts"] == 10000
        assert "_id" not in data

    def test_update_changes_source(self, session, reference):
        payload = sample_payload(reference, "Prospeo", 1000, cpc_map={"HQL": 10})
        r = session.put(f"{API}/rfps/{TestCRUD.created_id}", json=payload, timeout=30)
        assert r.status_code == 200
        g = session.get(f"{API}/rfps/{TestCRUD.created_id}", timeout=30).json()
        assert g["section3"]["data_source"] == "Prospeo"
        assert g["section3"]["data_counts"] == 1000
        rows = {row["lead_type"]: row for row in g["section3"]["rows"]}
        assert rows["HQL"]["lead_counts"] == 200  # Prospeo HQL = 20% of 1000

    def test_legacy_rfp_without_new_fields(self, session, reference):
        # Simulate an iteration-1 saved RFP: no data_source/data_counts
        payload = sample_payload(reference, "", 0)
        del payload["section3"]["data_source"]
        del payload["section3"]["data_counts"]
        r = session.post(f"{API}/rfps", json=payload, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["section3"].get("data_source") in (None, "")
        assert data["section3"].get("data_counts", 0) == 0
        # cleanup
        session.delete(f"{API}/rfps/{data['id']}", timeout=30)

    def test_export_csv_has_new_columns(self, session):
        r = session.get(f"{API}/rfps/export/csv", timeout=30)
        assert r.status_code == 200
        assert b"data_source" in r.content
        assert b"data_counts" in r.content

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

    def test_get_nonexistent(self, session):
        r = session.get(f"{API}/rfps/nope-xyz", timeout=30)
        assert r.status_code == 404
