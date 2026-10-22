import { api } from "../../lib/api";

// /api/sites 호출과 응답 타입 (서버: src/server/routes/sites)

export type ConsentMode = "auto" | "require";
export type SiteSummary = { sessions: number; pageviews: number; conversions: number; conversionValue: number };
export type Site = {
  id: string;
  name: string;
  siteKey: string;
  domains: string[];
  consentMode: ConsentMode;
  collectRawEmail: boolean;
  currency: string;
  attributionDays: number;
  firstEventAt: number | null;
  createdAt: number;
  snippet: string;
  summary: SiteSummary;
};
export type SiteInput = { name: string; domains: string[]; consentMode: ConsentMode; collectRawEmail: boolean };

export const sitesApi = {
  list: () => api.get<{ sites: Site[] }>("/sites").then((r) => r.sites),
  create: (input: SiteInput) => api.post<{ site: Site }>("/sites", input),
  update: (id: string, input: Partial<SiteInput>) => api.patch<{ ok: true }>(`/sites/${id}`, input),
  rotateKey: (id: string) => api.post<{ siteKey: string }>(`/sites/${id}/rotate-key`),
  remove: (id: string) => api.del<{ ok: true }>(`/sites/${id}`),
};
