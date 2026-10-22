import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Role } from "../../shared/roles";
import { api, ApiError } from "./api";

export type Me = {
  user: { id: string; email: string; name: string; phone: string | null };
  phoneVerified: boolean;
  workspace: { id: string; name: string; plan: string } | null;
  role: Role | null;
  workspaces: { id: string; name: string; plan: string; role: Role }[];
};

type MeState = { me: Me | null; loading: boolean; refresh: () => Promise<void> };
const MeContext = createContext<MeState>({ me: null, loading: true, refresh: async () => {} });

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me | null>("/auth/me", { redirectOn401: false }));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <MeContext.Provider value={{ me, loading, refresh }}>{children}</MeContext.Provider>;
}

export const useMe = () => useContext(MeContext);
