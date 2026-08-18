import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// withCredentials=true is required so the httpOnly auth cookies travel on every request.
export const api = axios.create({ baseURL: API, withCredentials: true });

// Callback that global 401s can trigger (registered by AuthContext to force logout).
let _onUnauthorized = null;
export const registerUnauthorizedHandler = (fn) => { _onUnauthorized = fn; };

// Response interceptor — log the exact URL/method/status on every 4xx/5xx so
// future user reports like "got a 404" carry a diagnosable footprint.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response) {
      const { status } = err.response;
      const method = (err.config?.method || "?").toUpperCase();
      const url = err.config?.baseURL ? `${err.config.baseURL}${err.config.url || ""}` : (err.config?.url || "?");
      console.error(`[API ${status}] ${method} ${url}`, err.response.data);
      // Auth-required routes returning 401 → clear session client-side.
      if (status === 401 && _onUnauthorized) {
        const path = err.config?.url || "";
        if (!path.includes("/auth/login") && !path.includes("/auth/me")) {
          _onUnauthorized();
        }
      }
    }
    return Promise.reject(err);
  }
);

// ---------------------------- Auth API ---------------------------- //

export const authLogin = async (email, password) =>
  (await api.post("/auth/login", { email, password })).data;
export const authLogout = async () => (await api.post("/auth/logout")).data;
export const authMe = async () => (await api.get("/auth/me")).data;
export const authChangePassword = async (current_password, new_password) =>
  (await api.post("/auth/change-password", { current_password, new_password })).data;

export const fetchUsers = async () => (await api.get("/users")).data;
export const createUser = async (payload) => (await api.post("/users", payload)).data;
export const updateUser = async (id, payload) => (await api.put(`/users/${id}`, payload)).data;
export const deleteUser = async (id) => (await api.delete(`/users/${id}`)).data;

export const fetchReference = async () => (await api.get("/reference")).data;
export const fetchRfps = async (params = {}) => (await api.get("/rfps", { params })).data;
export const fetchRfp = async (id) => (await api.get(`/rfps/${id}`)).data;
export const fetchStats = async () => (await api.get("/rfps/stats")).data;
export const fetchNextRef = async (date_of_rfp) =>
  (await api.get("/rfps/next-ref", { params: date_of_rfp ? { date_of_rfp } : {} })).data;
export const createRfp = async (payload) => (await api.post("/rfps", payload)).data;
export const updateRfp = async (id, payload) => (await api.put(`/rfps/${id}`, payload)).data;
export const deleteRfp = async (id) => (await api.delete(`/rfps/${id}`)).data;
export const previewCompute = async (payload) => (await api.post("/rfps/preview", payload)).data;

export const fetchFormula = async () => (await api.get("/settings/formula")).data;
export const updateFormula = async (payload) => (await api.put("/settings/formula", payload)).data;
export const resetFormula = async () => (await api.post("/settings/formula/reset")).data;

export const downloadFile = async (path, filename) => {
  const res = await api.get(path, { responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};
