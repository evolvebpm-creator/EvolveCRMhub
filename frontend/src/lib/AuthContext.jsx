import React from "react";
import { authLogin, authLogout, authMe, registerUnauthorizedHandler } from "../lib/apiClient";

const AuthContext = React.createContext(null);

export function AuthProvider({ children }) {
  // `null` = checking, `false` = logged out, object = logged in.
  const [user, setUser] = React.useState(null);
  const [error, setError] = React.useState("");

  const refresh = React.useCallback(async () => {
    try {
      const me = await authMe();
      setUser(me);
      return me;
    } catch {
      setUser(false);
      return null;
    }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  React.useEffect(() => {
    registerUnauthorizedHandler(() => setUser(false));
  }, []);

  const login = async (email, password) => {
    setError("");
    try {
      const me = await authLogin(email, password);
      setUser(me);
      return me;
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : (e?.message || "Login failed");
      setError(msg);
      throw e;
    }
  };

  const logout = async () => {
    try { await authLogout(); } catch { /* ignore */ }
    setUser(false);
  };

  const value = { user, error, login, logout, refresh, setUser };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => React.useContext(AuthContext);

export const hasRole = (user, ...allowed) => !!user && allowed.includes(user.role);
export const canEdit = (user) => hasRole(user, "editor", "admin");
export const canAdmin = (user) => hasRole(user, "admin");
