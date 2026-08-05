"""Backend tests for RFP Master Tracking API — Iteration 5.

BREAKING iteration: LEAD_TYPES=6 (MQL, HQL, BANT - DIGITAL, BANT - TELE, BANT +,
APPOINTMENT SET-UP). DATA_SOURCES=[VibeProspect, Prospeo, Apollo, Others].
Section 3 no longer has `data_counts`; formula uses section2.data_universe with
stacked modifiers (CPC divisor, CQ reduction, QQ reduction, TV toggle).
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

LEAD_TYPES_EXPECTED = [
    "MQL", "HQL", "BANT - DIGITAL", "BANT - TELE", "BANT +", "APPOINTMENT SET-UP",
]


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


def _rows(cpl_map=None):
    cpl_map = cpl_map or {}
    return [
        {"lead_type": lt, "cpl": cpl_map.get(lt, 0), "lead_counts": 0, "total_cost": 0}
        for lt in LEAD_TYPES_EXPECTED
    ]


def make_payload(*, types=None, data_source="VibeProspect", data_universe=10000,
                 contacts_per_company=0, num_cq=0, num_qq=0, with_tv=False,
                 cpl_map=None):
    return {
        "section1": {
            "rfp_master_tracking_sheet": "TEST_ITER5",
            "date_of_rfp": "2026-07-01",
            "campaign_run_date": {"start_date": "2026-07-10", "end_date": "2026-07-31"},
            "client_id": "EVCL001",
            "campaign_name": "TEST_Iter5",
            "campaign_id": "TEST-ITER5-001",
            "end_client_name": "TEST_Client5",
            "target_geography": [],
            "target_industries": [],
            "revenue_size": [],
            "employee_size": [],
            "target_job_functions": [],
            "target_job_titles": [],
            "target_job_seniority": [],
            "contacts_per_company": contacts_per_company,
            "exclusions": "",
            "suppression_file": "",
            "campaign_type_config": {
                "types": types or [],
                "num_qq": num_qq,
                "num_cq": num_cq,
                "num_touches": 0,
                "with_tv": with_tv,
            },
        },
        "section2": {"data_universe": data_universe},
        "section3": {
            "data_source": data_source,
            "rows": _rows(cpl_map),
            "grand_total_leads": 0,
            "grand_total_cost": 0,
            "blended_cpl": 0,
        },
        "section4": {"rfp_submitted_date": "", "rfp_converted": "N", "volumes_assigned": 0},
    }


# ---------------- Reference endpoint ---------------- #
class TestReference:
    def test_lead_types(self, reference):
        assert reference["lead_types"] == LEAD_TYPES_EXPECTED

    def test_data_sources(self, reference):
        assert reference["data_sources"] == ["VibeProspect", "Prospeo", "Apollo", "Others"]

    def test_conversion_rates(self, reference):
        cr = reference["conversion_rates"]
        assert cr["VibeProspect"]["MQL"] == 45
        assert cr["VibeProspect"]["APPOINTMENT SET-UP"] == 5
        assert cr["Prospeo"]["HQL"] == 20
        assert cr["Apollo"]["BANT - TELE"] == 5
        assert cr["Others"]["BANT +"] == 2

    def test_modifier_maps(self, reference):
        # JSON keys become strings
        cpc = reference["cpc_divisors"]
        assert float(cpc["1"]) == 5.0 and float(cpc["3"]) == 2.0 and float(cpc["5"]) == 1.25
        cq = reference["cq_reductions"]
        assert float(cq["1"]) == 0.15 and float(cq["2"]) == 0.25 and float(cq["5"]) == 0.50
        qq = reference["qq_reductions"]
        assert float(qq["3"]) == 0.45 and float(qq["5"]) == 0.60
        assert float(reference["tv_reduction"]) == 0.10

    def test_campaign_types(self, reference):
        ct = reference["campaign_types"]
        for t in ["BANT - Digital", "BANT - Tele", "BANT +", "Appointment Set-up"]:
            assert t in ct, f"missing campaign type: {t}"


# ---------------- Preview: modifier stacking ---------------- #
class TestModifierMath:
    def _mql_count(self, session, **kwargs):
        payload = make_payload(types=["MQL"], **kwargs)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        return rows["MQL"]["lead_counts"], r.json()["section3"]

    def test_baseline(self, session):
        # contacts=0 -> no CPC divisor (1.0); no CQ/QQ/TV
        mql, _ = self._mql_count(session, data_source="VibeProspect", data_universe=10000)
        assert mql == 4500

    def test_cpc_only(self, session):
        mql, _ = self._mql_count(session, data_source="VibeProspect",
                                 data_universe=10000, contacts_per_company=3)
        assert mql == 2250

    def test_cpc_plus_cq(self, session):
        # 4500 / 2 * 0.75 = 1687.5 -> banker's round = 1688
        mql, _ = self._mql_count(session, data_source="VibeProspect",
                                 data_universe=10000, contacts_per_company=3, num_cq=2)
        assert mql == 1688

    def test_cpc_cq_qq(self, session):
        # 1687.5 * 0.55 = 928.125 -> 928
        mql, _ = self._mql_count(session, data_source="VibeProspect",
                                 data_universe=10000, contacts_per_company=3,
                                 num_cq=2, num_qq=3)
        assert mql == 928

    def test_full_stack_with_tv(self, session):
        # 928.125 * 0.9 = 835.3125 -> 835
        mql, _ = self._mql_count(session, data_source="VibeProspect",
                                 data_universe=10000, contacts_per_company=3,
                                 num_cq=2, num_qq=3, with_tv=True)
        assert mql == 835


class TestMultiRow:
    def test_three_rows_full_stack(self, session):
        payload = make_payload(
            types=["MQL", "HQL", "BANT - Digital"],
            data_source="VibeProspect", data_universe=10000,
            contacts_per_company=3, num_cq=2, num_qq=3, with_tv=True,
        )
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        assert r.status_code == 200
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["MQL"]["lead_counts"] == 835
        assert rows["HQL"]["lead_counts"] == 464
        assert rows["BANT - DIGITAL"]["lead_counts"] == 278
        # Untargeted rows must be zero
        assert rows["BANT - TELE"]["lead_counts"] == 0
        assert rows["BANT +"]["lead_counts"] == 0
        assert rows["APPOINTMENT SET-UP"]["lead_counts"] == 0

    def test_non_targeted_row_ignored_despite_cpl(self, session):
        payload = make_payload(
            types=["MQL"],
            data_source="VibeProspect", data_universe=10000,
            cpl_map={"APPOINTMENT SET-UP": 100},
        )
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["APPOINTMENT SET-UP"]["lead_counts"] == 0
        assert rows["APPOINTMENT SET-UP"]["total_cost"] == 0

    def test_others_source_all_rows(self, session):
        payload = make_payload(
            types=["MQL", "HQL", "BANT - Digital", "BANT - Tele", "BANT +", "Appointment Set-up"],
            data_source="Others", data_universe=10000,
        )
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        rows = {row["lead_type"]: row for row in r.json()["section3"]["rows"]}
        assert rows["MQL"]["lead_counts"] == 1500
        assert rows["HQL"]["lead_counts"] == 1000
        assert rows["BANT - DIGITAL"]["lead_counts"] == 500
        assert rows["BANT - TELE"]["lead_counts"] == 300
        assert rows["BANT +"]["lead_counts"] == 200
        assert rows["APPOINTMENT SET-UP"]["lead_counts"] == 100


# ---------------- Data Universe auto-suggest ---------------- #
class TestDataUniverse:
    def test_auto_suggest_when_zero(self, session, reference):
        payload = make_payload(types=["MQL"], data_source="VibeProspect", data_universe=0)
        # Add filters to trigger heuristic
        payload["section1"]["target_geography"] = reference["geographies"][:2]
        payload["section1"]["target_industries"] = reference["industries"][:2]
        payload["section1"]["employee_size"] = reference["employee_sizes"][:1]
        payload["section1"]["revenue_size"] = reference["revenue_sizes"][:1]
        payload["section1"]["contacts_per_company"] = 2
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        assert r.status_code == 200
        du = r.json()["section2"]["data_universe"]
        assert du > 0, "Universe should auto-suggest when zero"

    def test_user_value_preserved(self, session):
        payload = make_payload(types=["MQL"], data_source="VibeProspect", data_universe=10000)
        r = session.post(f"{API}/rfps/preview", json=payload, timeout=30)
        assert r.json()["section2"]["data_universe"] == 10000


# ---------------- CRUD, persistence, exports ---------------- #
class TestPersistenceAndExports:
    created_id = None

    def test_create_persists_with_tv_no_data_counts(self, session):
        payload = make_payload(
            types=["MQL", "HQL", "BANT - Digital"],
            data_source="VibeProspect", data_universe=10000,
            contacts_per_company=3, num_cq=2, num_qq=3, with_tv=True,
            cpl_map={"MQL": 10, "HQL": 25, "BANT - DIGITAL": 50},
        )
        r = session.post(f"{API}/rfps", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["section1"]["campaign_type_config"]["with_tv"] is True
        # data_counts must NOT persist in section3
        assert "data_counts" not in data["section3"]
        s3 = data["section3"]
        assert s3["grand_total_leads"] == 1577
        assert s3["grand_total_cost"] == 33850
        assert s3["blended_cpl"] == 21.46
        TestPersistenceAndExports.created_id = data["id"]

    def test_get_roundtrip(self, session):
        r = session.get(f"{API}/rfps/{TestPersistenceAndExports.created_id}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["section1"]["campaign_type_config"]["with_tv"] is True
        assert "data_counts" not in d["section3"]
        assert "_id" not in d

    def test_csv_has_with_tv_no_data_counts(self, session):
        r = session.get(f"{API}/rfps/export/csv", timeout=30)
        assert r.status_code == 200
        header = r.content.decode("utf-8").splitlines()[0]
        cols = header.split(",")
        assert "with_tv" in cols
        assert "data_counts" not in cols

    def test_xlsx_export(self, session):
        r = session.get(f"{API}/rfps/export/xlsx", timeout=30)
        assert r.status_code == 200
        assert r.content[:2] == b"PK"

    def test_stats(self, session):
        r = session.get(f"{API}/rfps/stats", timeout=30)
        assert r.status_code == 200
        s = r.json()
        for k in ["total_rfps", "converted_rfps", "pending_rfps", "conversion_rate",
                  "total_lead_volume", "lead_type_distribution", "monthly_series"]:
            assert k in s
        lt_keys = {x["lead_type"] for x in s["lead_type_distribution"]}
        assert lt_keys == set(LEAD_TYPES_EXPECTED)

    def test_delete(self, session):
        r = session.delete(f"{API}/rfps/{TestPersistenceAndExports.created_id}", timeout=30)
        assert r.status_code == 200
        g = session.get(f"{API}/rfps/{TestPersistenceAndExports.created_id}", timeout=30)
        assert g.status_code == 404


# ---------------- Regression: next-ref format ---------------- #
class TestRegression:
    def test_next_ref_format(self, session):
        r = session.get(f"{API}/rfps/next-ref?date_of_rfp=2026-07-15", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["preview"].startswith("EV_Q_")
        assert data["preview"].endswith("_20260715")
