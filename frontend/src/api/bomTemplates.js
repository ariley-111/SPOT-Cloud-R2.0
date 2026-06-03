/* eslint-disable */
import client from "./client";

/** List personal + team templates available to the current user. */
export const listBomTemplates = () =>
  client.get("/bom-templates").then((r) => r.data);

/** Create a new template. body = {name, scope, default_qtys, components} */
export const createBomTemplate = (body) =>
  client.post("/bom-templates", body).then((r) => r.data);

/** Update by id. body = {name?, scope?, default_qtys?, components?} */
export const updateBomTemplate = (tid, body) =>
  client.put(`/bom-templates/${tid}`, body).then((r) => r.data);

/** Delete by id (owner or admin). */
export const deleteBomTemplate = (tid) =>
  client.delete(`/bom-templates/${tid}`).then((r) => r.data);

/** Promote a personal template to team (owner or admin). */
export const promoteBomTemplate = (tid) =>
  client.post(`/bom-templates/${tid}/promote`).then((r) => r.data);
