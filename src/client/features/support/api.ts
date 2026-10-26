import { api } from "../../lib/api";
import type { SupportBody, SupportRequestItem } from "../../../shared/support";

export const fetchSupportRequests = () => api.get<{ requests: SupportRequestItem[] }>("/support").then((r) => r.requests);
export const sendSupportRequest = (body: SupportBody) => api.post<{ request: SupportRequestItem }>("/support", body).then((r) => r.request);
