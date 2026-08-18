# Auth Testing Playbook (RFP Master Tracking)

## MongoDB Verification
```
mongosh
use <db>   # value from backend/.env DB_NAME
db.users.find({role:"admin"}).pretty()
db.users.getIndexes()
db.login_attempts.getIndexes()
db.password_reset_tokens.getIndexes()
```
Verify:
- Admin user exists with `email == ADMIN_EMAIL`, `role == "admin"`, hash starts with `$2b$`.
- Unique index on `users.email`.
- Index on `login_attempts.identifier`.
- TTL index on `password_reset_tokens.expires_at`.

## API smoke tests
```
API_URL=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d = -f2)

# Login (writes cookies)
curl -c /tmp/cookies.txt -X POST "$API_URL/api/auth/login" \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@evolvebpm.com","password":"EvolveBPM@2026"}'

# Session probe
curl -b /tmp/cookies.txt "$API_URL/api/auth/me"

# Admin-only endpoint
curl -b /tmp/cookies.txt "$API_URL/api/users"

# Logout
curl -b /tmp/cookies.txt -X POST "$API_URL/api/auth/logout"
```

## E2E frontend flow (Playwright / testing agent)
1. Load app root → expect `[data-testid="login-page"]` (redirected because unauthenticated).
2. Fill `login-email`, `login-password`; click `login-submit`. Expect header to show admin email + logout button.
3. Navigate to `Admin → Users`. See admin row. Add a user (viewer role). Log in as that viewer in a fresh context — verify they cannot see the Admin tab, cannot see "+ New RFP" button, cannot see edit/delete buttons on RFP rows.
4. As admin, promote viewer to editor. Editor CAN see + New RFP / edit / delete but not Admin.
5. Logout → back to login page. Session cookie cleared.
