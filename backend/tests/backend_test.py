"""
Backend tests for iter-8: JWT auth, user management, RBAC, and regression on
existing RFP endpoints. Uses cookie-based sessions (httpOnly).
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing from env and /app/frontend/.env")
BASE = base_url.rstrip("/")

ADMIN_EMAIL = "admin@evolvebpm.com"
ADMIN_PASSWORD = "EvolveBPM@2026"

VIEWER_EMAIL = f"TEST_viewer_{uuid.uuid4().hex[:6]}@evolvebpm.com"
EDITOR_EMAIL = f"TEST_editor_{uuid.uuid4().hex[:6]}@evolvebpm.com"
STANDARD_PW = "Passw0rd!"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    return s, r


@pytest.fixture(scope="session")
def admin_session():
    s, r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body["email"] == ADMIN_EMAIL
    assert body["role"] == "admin"
    # verify cookies were set (httpOnly cookies from Set-Cookie)
    assert "access_token" in s.cookies.get_dict()
    return s


@pytest.fixture(scope="session")
def viewer_and_editor(admin_session):
    """Create a viewer + editor user via admin panel; yield sessions for both."""
    # Create viewer
    r = admin_session.post(f"{BASE}/api/users", json={
        "email": VIEWER_EMAIL, "name": "Test Viewer", "role": "viewer", "password": STANDARD_PW,
    })
    assert r.status_code == 201, f"Create viewer: {r.status_code} {r.text}"
    viewer_id = r.json()["id"]
    # Create editor
    r = admin_session.post(f"{BASE}/api/users", json={
        "email": EDITOR_EMAIL, "name": "Test Editor", "role": "editor", "password": STANDARD_PW,
    })
    assert r.status_code == 201, f"Create editor: {r.status_code} {r.text}"
    editor_id = r.json()["id"]

    vs, vr = _login(VIEWER_EMAIL, STANDARD_PW)
    assert vr.status_code == 200
    es, er = _login(EDITOR_EMAIL, STANDARD_PW)
    assert er.status_code == 200

    yield {
        "viewer_session": vs, "viewer_id": viewer_id,
        "editor_session": es, "editor_id": editor_id,
    }

    # cleanup
    admin_session.delete(f"{BASE}/api/users/{viewer_id}")
    admin_session.delete(f"{BASE}/api/users/{editor_id}")


# ------------------------- AUTH BASICS -------------------------

class TestAuthBasics:
    def test_me_unauth_returns_401(self):
        r = requests.get(f"{BASE}/api/auth/me", timeout=10)
        assert r.status_code == 401

    def test_login_ok_and_me(self, admin_session):
        r = admin_session.get(f"{BASE}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_login_invalid_credentials(self):
        r = requests.post(f"{BASE}/api/auth/login",
                          json={"email": "nobody@evolvebpm.com", "password": "wrong"}, timeout=10)
        assert r.status_code == 401
        assert "detail" in r.json()

    def test_logout(self):
        s, r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert r.status_code == 200
        assert s.get(f"{BASE}/api/auth/me").status_code == 200
        assert s.post(f"{BASE}/api/auth/logout").status_code == 200
        # After logout cookies should be cleared server-side
        s2 = requests.Session()  # empty
        assert s2.get(f"{BASE}/api/auth/me").status_code == 401


# ------------------------- BRUTE FORCE LOCKOUT -------------------------

def _mongo_db():
    """Direct MongoDB handle used only by lockout tests to inspect/cleanup login_attempts."""
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL") or dotenv_values("/app/backend/.env").get("MONGO_URL")
    db_name = os.environ.get("DB_NAME") or dotenv_values("/app/backend/.env").get("DB_NAME")
    return MongoClient(mongo_url)[db_name]


class TestBruteForce:
    def test_lockout_7_attempts_and_single_db_record(self):
        """iter-9 fix verification: 7 consecutive wrong-password POSTs from a single
        external browser IP. Attempts 1-5 → 401. Attempts 6-7 → 429 with the specific
        detail message. db.login_attempts must contain ONE record for that email
        (not split across multiple identifiers)."""
        bad_email = f"test_lockout_{uuid.uuid4().hex[:8]}@evolvebpm.com"
        db = _mongo_db()
        # Ensure clean slate
        db.login_attempts.delete_many({"identifier": {"$regex": f":{bad_email}$"}})
        try:
            results = []
            for i in range(7):
                r = requests.post(f"{BASE}/api/auth/login",
                                  json={"email": bad_email, "password": "wrong"},
                                  timeout=15)
                results.append((i + 1, r.status_code, r.json() if r.content else {}))
                time.sleep(0.05)

            codes = [c for _, c, _ in results]
            # Attempts 1..5 must be 401
            assert codes[:5] == [401] * 5, f"Expected first 5 attempts=401, got {codes}"
            # Attempts 6 and 7 must be 429 (locked out)
            assert codes[5] == 429, f"Expected attempt 6 = 429 (lockout), got {codes}"
            assert codes[6] == 429, f"Expected attempt 7 = 429 (lockout), got {codes}"

            # Verify specific 429 detail message
            detail_6 = results[5][2].get("detail", "")
            assert "Too many failed attempts" in detail_6, f"Unexpected 429 detail: {detail_6!r}"
            assert "15 minutes" in detail_6, f"Unexpected 429 detail: {detail_6!r}"

            # Verify DB has exactly ONE login_attempts record for this email
            docs = list(db.login_attempts.find({"identifier": {"$regex": f":{bad_email}$"}}))
            assert len(docs) == 1, (
                f"Expected exactly 1 login_attempts doc for {bad_email}, "
                f"found {len(docs)}: {[d.get('identifier') for d in docs]}"
            )
            doc = docs[0]
            assert doc.get("count", 0) >= 5, f"Expected count >=5, got {doc.get('count')}"
            assert "locked_until" in doc, "Expected locked_until to be set"
        finally:
            db.login_attempts.delete_many({"identifier": {"$regex": f":{bad_email}$"}})

    def test_success_on_first_attempt_does_not_leave_counter(self):
        """Fresh successful login should not create/leave a login_attempts record."""
        db = _mongo_db()
        # Prune any prior residue for admin email
        db.login_attempts.delete_many({"identifier": {"$regex": f":{ADMIN_EMAIL}$"}})
        s, r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert r.status_code == 200
        docs = list(db.login_attempts.find({"identifier": {"$regex": f":{ADMIN_EMAIL}$"}}))
        assert docs == [], f"Successful login should not leave login_attempts, found {docs}"

    def test_successful_login_clears_counter(self):
        """After 3 bad attempts a correct-password login should succeed and clear the counter."""
        db = _mongo_db()
        # Create a temp user via admin so we have a real password to succeed with
        s_admin, r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert r.status_code == 200
        email = f"test_clear_{uuid.uuid4().hex[:8]}@evolvebpm.com"
        r = s_admin.post(f"{BASE}/api/users",
                         json={"email": email, "name": "clear", "role": "viewer",
                               "password": STANDARD_PW})
        assert r.status_code == 201
        uid = r.json()["id"]
        try:
            # 3 bad attempts → counter should be 3
            for _ in range(3):
                requests.post(f"{BASE}/api/auth/login",
                              json={"email": email, "password": "wrong"}, timeout=10)
            docs = list(db.login_attempts.find({"identifier": {"$regex": f":{email}$"}}))
            assert docs and docs[0]["count"] == 3, f"Expected count=3, got {docs}"
            # Correct login → should succeed and delete counter
            _, r_ok = _login(email, STANDARD_PW)
            assert r_ok.status_code == 200
            docs2 = list(db.login_attempts.find({"identifier": {"$regex": f":{email}$"}}))
            assert docs2 == [], f"Counter should be cleared after success, found {docs2}"
        finally:
            s_admin.delete(f"{BASE}/api/users/{uid}")
            db.login_attempts.delete_many({"identifier": {"$regex": f":{email}$"}})

    def test_expired_lockout_allows_login(self):
        """Manually backdate locked_until → next attempt should NOT be 429."""
        from datetime import datetime, timezone, timedelta
        db = _mongo_db()
        s_admin, r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert r.status_code == 200
        email = f"test_expired_{uuid.uuid4().hex[:8]}@evolvebpm.com"
        r = s_admin.post(f"{BASE}/api/users",
                         json={"email": email, "name": "expired", "role": "viewer",
                               "password": STANDARD_PW})
        assert r.status_code == 201
        uid = r.json()["id"]
        try:
            # Trigger one bad attempt so identifier resolves for this client IP
            r = requests.post(f"{BASE}/api/auth/login",
                              json={"email": email, "password": "wrong"}, timeout=10)
            assert r.status_code == 401
            docs = list(db.login_attempts.find({"identifier": {"$regex": f":{email}$"}}))
            assert docs
            ident = docs[0]["identifier"]
            # Force count=5 with locked_until in the past
            db.login_attempts.update_one(
                {"identifier": ident},
                {"$set": {"count": 5,
                          "locked_until": datetime.now(timezone.utc) - timedelta(minutes=1)}},
            )
            # Correct password should now succeed (lockout window elapsed)
            _, r_ok = _login(email, STANDARD_PW)
            assert r_ok.status_code == 200, f"Expected 200 after lockout expiry, got {r_ok.status_code} {r_ok.text}"
        finally:
            s_admin.delete(f"{BASE}/api/users/{uid}")
            db.login_attempts.delete_many({"identifier": {"$regex": f":{email}$"}})

    def test_naive_locked_until_returns_429_not_500(self):
        """Regression for the naive-vs-aware datetime bug: manually seed a login_attempts
        doc with a NAIVE locked_until in the future + count=5. Next login attempt for that
        identifier must return 429 (not TypeError-500)."""
        from datetime import datetime, timedelta
        db = _mongo_db()
        email = f"test_naive_{uuid.uuid4().hex[:8]}@evolvebpm.com"
        # Prime the identifier by making one wrong attempt (to learn what XFF-based ident is)
        r = requests.post(f"{BASE}/api/auth/login",
                          json={"email": email, "password": "wrong"}, timeout=10)
        assert r.status_code == 401
        docs = list(db.login_attempts.find({"identifier": {"$regex": f":{email}$"}}))
        assert docs, "expected login_attempts entry to exist"
        ident = docs[0]["identifier"]
        try:
            # Force count=5 + NAIVE datetime future locked_until (simulates what motor
            # would return without tz_aware).
            naive_future = datetime.utcnow() + timedelta(minutes=10)
            assert naive_future.tzinfo is None
            db.login_attempts.update_one(
                {"identifier": ident},
                {"$set": {"count": 5, "locked_until": naive_future}},
            )
            r = requests.post(f"{BASE}/api/auth/login",
                              json={"email": email, "password": "wrong"}, timeout=10)
            assert r.status_code == 429, (
                f"Expected 429 with naive locked_until, got {r.status_code} {r.text[:200]}"
            )
            assert "Too many failed attempts" in r.json().get("detail", "")
        finally:
            db.login_attempts.delete_many({"identifier": ident})


# ------------------------- CHANGE PASSWORD -------------------------

class TestChangePassword:
    def test_change_password_flow(self, admin_session):
        """Create a temp user, change its password, verify old fails + new works."""
        email = f"TEST_cp_{uuid.uuid4().hex[:6]}@evolvebpm.com"
        r = admin_session.post(f"{BASE}/api/users",
                               json={"email": email, "name": "cp", "role": "viewer",
                                     "password": STANDARD_PW})
        assert r.status_code == 201
        uid = r.json()["id"]
        try:
            us, ur = _login(email, STANDARD_PW)
            assert ur.status_code == 200
            # wrong current
            r = us.post(f"{BASE}/api/auth/change-password",
                        json={"current_password": "bogus", "new_password": "NewPassw0rd!"})
            assert r.status_code == 400
            # correct current
            r = us.post(f"{BASE}/api/auth/change-password",
                        json={"current_password": STANDARD_PW, "new_password": "NewPassw0rd!"})
            assert r.status_code == 200
            # old should fail, new should work
            _, r_old = _login(email, STANDARD_PW)
            assert r_old.status_code == 401
            _, r_new = _login(email, "NewPassw0rd!")
            assert r_new.status_code == 200
        finally:
            admin_session.delete(f"{BASE}/api/users/{uid}")


# ------------------------- USER MANAGEMENT (admin) -------------------------

class TestUserManagement:
    def test_list_users_admin(self, admin_session):
        r = admin_session.get(f"{BASE}/api/users")
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert ADMIN_EMAIL in emails

    def test_create_and_delete_user(self, admin_session):
        email = f"TEST_crud_{uuid.uuid4().hex[:6]}@evolvebpm.com"
        r = admin_session.post(f"{BASE}/api/users",
                               json={"email": email, "name": "crud", "role": "viewer",
                                     "password": STANDARD_PW})
        assert r.status_code == 201
        uid = r.json()["id"]
        assert r.json()["role"] == "viewer"
        # duplicate
        dup = admin_session.post(f"{BASE}/api/users",
                                 json={"email": email, "name": "x", "role": "viewer",
                                       "password": STANDARD_PW})
        assert dup.status_code == 409
        # promote to editor
        r = admin_session.put(f"{BASE}/api/users/{uid}", json={"role": "editor"})
        assert r.status_code == 200 and r.json()["role"] == "editor"
        # delete
        r = admin_session.delete(f"{BASE}/api/users/{uid}")
        assert r.status_code == 200

    def test_admin_cannot_delete_self(self, admin_session):
        me = admin_session.get(f"{BASE}/api/auth/me").json()
        r = admin_session.delete(f"{BASE}/api/users/{me['id']}")
        assert r.status_code == 400
        assert "own account" in r.json().get("detail", "").lower()

    def test_admin_cannot_demote_last_admin(self, admin_session):
        me = admin_session.get(f"{BASE}/api/auth/me").json()
        # Ensure there is only 1 admin at time of test (fixture creates non-admins only)
        users = admin_session.get(f"{BASE}/api/users").json()
        admin_count = sum(1 for u in users if u["role"] == "admin")
        if admin_count > 1:
            pytest.skip("More than one admin exists; cannot verify last-admin protection")
        r = admin_session.put(f"{BASE}/api/users/{me['id']}", json={"role": "viewer"})
        assert r.status_code == 400
        assert "last admin" in r.json().get("detail", "").lower()


# ------------------------- RBAC -------------------------

class TestRBAC:
    def test_viewer_cannot_create_rfp(self, viewer_and_editor):
        vs = viewer_and_editor["viewer_session"]
        r = vs.post(f"{BASE}/api/rfps", json={})
        assert r.status_code == 403

    def test_viewer_can_get_rfps(self, viewer_and_editor):
        vs = viewer_and_editor["viewer_session"]
        assert vs.get(f"{BASE}/api/rfps").status_code == 200

    def test_viewer_cannot_list_users(self, viewer_and_editor):
        vs = viewer_and_editor["viewer_session"]
        assert vs.get(f"{BASE}/api/users").status_code == 403

    def test_editor_cannot_list_users(self, viewer_and_editor):
        es = viewer_and_editor["editor_session"]
        assert es.get(f"{BASE}/api/users").status_code == 403

    def test_editor_cannot_put_formula(self, viewer_and_editor):
        es = viewer_and_editor["editor_session"]
        r = es.put(f"{BASE}/api/settings/formula", json={"tv_reduction": 0.10})
        assert r.status_code == 403

    def test_editor_can_crud_rfp(self, viewer_and_editor, admin_session):
        es = viewer_and_editor["editor_session"]
        # create
        payload = {
            "section1": {"campaign_name": "TEST_ITER8_RBAC", "date_of_rfp": "2026-07-01",
                         "contacts_per_company": 1,
                         "target_geography": ["United States"],
                         "campaign_type_config": {"types": ["MQL"], "num_qq": 0, "num_cq": 0,
                                                  "num_touches": 1, "with_tv": False}},
            "section2": {"data_universe": 10000},
            "section3": {"data_source": "VibeProspect", "rows": [{"lead_type": "MQL", "cpl": 10}]},
            "section4": {"rfp_converted": "N"},
        }
        r = es.post(f"{BASE}/api/rfps", json=payload)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        try:
            # update
            r = es.put(f"{BASE}/api/rfps/{rid}", json=payload)
            assert r.status_code == 200
            # GET
            r = es.get(f"{BASE}/api/rfps/{rid}")
            assert r.status_code == 200
        finally:
            es.delete(f"{BASE}/api/rfps/{rid}")


# ------------------------- REGRESSION on existing endpoints -------------------------

class TestRegression:
    endpoints = [
        "/api/reference",
        "/api/rfps/next-ref",
        "/api/rfps/stats",
        "/api/rfps",
    ]

    @pytest.mark.parametrize("path", endpoints)
    def test_unauth_401(self, path):
        r = requests.get(f"{BASE}{path}", timeout=10)
        assert r.status_code == 401, f"{path} should require auth: {r.status_code}"

    @pytest.mark.parametrize("path", endpoints)
    def test_authed_200(self, admin_session, path):
        r = admin_session.get(f"{BASE}{path}")
        assert r.status_code == 200, f"{path} failed: {r.status_code} {r.text[:200]}"

    def test_preview_authed(self, admin_session):
        payload = {
            "section1": {"target_geography": ["United States"], "contacts_per_company": 1,
                         "campaign_type_config": {"types": ["MQL"]}},
            "section2": {"data_universe": 5000},
            "section3": {"data_source": "VibeProspect", "rows": [{"lead_type": "MQL", "cpl": 5}]},
            "section4": {},
        }
        r = admin_session.post(f"{BASE}/api/rfps/preview", json=payload)
        assert r.status_code == 200
        body = r.json()
        assert "section2" in body and "section3" in body

    def test_preview_unauth(self):
        r = requests.post(f"{BASE}/api/rfps/preview", json={}, timeout=10)
        assert r.status_code == 401
