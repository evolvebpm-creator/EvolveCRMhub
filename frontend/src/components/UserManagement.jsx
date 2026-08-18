import React from "react";
import { fetchUsers, createUser, updateUser, deleteUser } from "../lib/apiClient";
import { useAuth } from "../lib/AuthContext";
import { UserPlus, Trash2, Save } from "lucide-react";

const ROLES = ["viewer", "editor", "admin"];
const ROLE_DESC = {
  viewer: "Read-only across Dashboard, All RFPs, and Proposals.",
  editor: "Everything Viewer + create / edit / delete RFPs.",
  admin: "Everything Editor + Admin panel (formula, countries, users).",
};

export default function UserManagement() {
  const { user: me } = useAuth();
  const [users, setUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [invite, setInvite] = React.useState({ email: "", name: "", role: "viewer", password: "" });

  const load = React.useCallback(() => {
    setLoading(true);
    setError("");
    fetchUsers()
      .then(setUsers)
      .catch((e) => setError(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const doInvite = async () => {
    setStatus("");
    if (!invite.email || (invite.password || "").length < 8) {
      setError("Email required · password ≥ 8 characters.");
      return;
    }
    try {
      await createUser(invite);
      setInvite({ email: "", name: "", role: "viewer", password: "" });
      setStatus(`Invited ${invite.email} as ${invite.role}.`);
      setError("");
      load();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    }
  };

  const changeRole = async (u, newRole) => {
    setStatus("");
    try {
      await updateUser(u.id, { role: newRole });
      setStatus(`Role updated for ${u.email} → ${newRole}.`);
      load();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Remove ${u.email}? This cannot be undone.`)) return;
    try {
      await deleteUser(u.id);
      setStatus(`Removed ${u.email}.`);
      load();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    }
  };

  const resetPassword = async (u) => {
    const newPass = window.prompt(`Set new temporary password for ${u.email}? (min 8 chars)`);
    if (!newPass) return;
    if (newPass.length < 8) { setError("Password must be at least 8 characters."); return; }
    try {
      await updateUser(u.id, { password: newPass });
      setStatus(`Password reset for ${u.email}. Share the new temp password with them.`);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    }
  };

  return (
    <section className="panel p-6 md:p-8" data-testid="admin-user-panel">
      <div className="flex flex-wrap justify-between gap-4 mb-4">
        <div>
          <div className="font-label">Team & Access</div>
          <h3 className="font-serif-display text-2xl mt-1">User Management</h3>
          <div className="font-mono-tight text-xs text-[#666] mt-2 max-w-2xl">
            Invite team members and control what they can do. Roles:
            <ul className="mt-2 ml-4 list-disc">
              {ROLES.map((r) => (
                <li key={r}>
                  <strong className="uppercase">{r}</strong> — {ROLE_DESC[r]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Invite */}
      <div className="border border-[#DCDCCF] bg-[#FAFAF5] p-4 mb-6" data-testid="admin-user-invite">
        <div className="font-label mb-3">Invite a New User</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            data-testid="invite-email"
            className="evcl-input"
            placeholder="email@evolvebpm.com"
            value={invite.email}
            onChange={(e) => setInvite((p) => ({ ...p, email: e.target.value }))}
          />
          <input
            data-testid="invite-name"
            className="evcl-input"
            placeholder="Full name (optional)"
            value={invite.name}
            onChange={(e) => setInvite((p) => ({ ...p, name: e.target.value }))}
          />
          <select
            data-testid="invite-role"
            className="evcl-input"
            value={invite.role}
            onChange={(e) => setInvite((p) => ({ ...p, role: e.target.value }))}
          >
            {ROLES.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
          <input
            data-testid="invite-password"
            className="evcl-input"
            type="text"
            placeholder="Temporary password (≥ 8 chars)"
            value={invite.password}
            onChange={(e) => setInvite((p) => ({ ...p, password: e.target.value }))}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            data-testid="invite-submit"
            className="btn-primary"
            onClick={doInvite}
          >
            <UserPlus size={14} strokeWidth={1.5} className="inline mr-1" />
            [ Send Invite ]
          </button>
        </div>
      </div>

      {status && (
        <div data-testid="admin-user-status" className="font-mono-tight text-xs bg-[#F0F0EE] border-l-2 border-[#0A0A0A] px-3 py-2 mb-4">
          {status}
        </div>
      )}
      {error && (
        <div data-testid="admin-user-error" className="font-mono-tight text-xs bg-[#FEF3F2] border-l-2 border-[#D92D20] text-[#D92D20] px-3 py-2 mb-4">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="evcl-table" data-testid="admin-user-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Created</th>
              <th className="num">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="text-center py-4 font-mono-tight text-xs text-[#666]">Loading…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={5} className="text-center py-4 font-mono-tight text-xs text-[#666]">No users yet.</td></tr>
            )}
            {users.map((u) => {
              const isSelf = me?.id === u.id;
              return (
                <tr key={u.id} data-testid={`user-row-${u.id}`}>
                  <td className="font-mono-tight">{u.email}{isSelf && <span className="text-[#666] text-[10px] ml-2">(you)</span>}</td>
                  <td className="font-mono-tight">{u.name || "—"}</td>
                  <td>
                    <select
                      data-testid={`user-role-${u.id}`}
                      className="evcl-input"
                      style={{ width: "140px" }}
                      value={u.role}
                      disabled={isSelf}
                      onChange={(e) => changeRole(u, e.target.value)}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                    </select>
                  </td>
                  <td className="font-mono-tight text-xs">{(u.created_at || "").slice(0, 10)}</td>
                  <td className="num">
                    <div className="flex gap-2 justify-end">
                      <button
                        data-testid={`user-reset-${u.id}`}
                        className="btn-secondary"
                        onClick={() => resetPassword(u)}
                        style={{ fontSize: "0.65rem", padding: "0.35rem 0.6rem" }}
                        title="Set a new temporary password"
                      >
                        <Save size={12} strokeWidth={1.5} className="inline mr-1" />
                        Reset PW
                      </button>
                      <button
                        data-testid={`user-delete-${u.id}`}
                        className="btn-danger"
                        onClick={() => remove(u)}
                        disabled={isSelf}
                      >
                        <Trash2 size={12} strokeWidth={1.5} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
