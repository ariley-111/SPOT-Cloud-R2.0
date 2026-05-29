/* eslint-disable */
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API_BASE, timeout: 60000 });

client.interceptors.request.use((cfg) => {
  const tok = localStorage.getItem("spot_token");
  if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
  return cfg;
});

client.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      // Token invalid/expired — clear and let caller redirect
      localStorage.removeItem("spot_token");
    }
    return Promise.reject(err);
  }
);

export default client;
