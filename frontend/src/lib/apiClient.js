import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

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
