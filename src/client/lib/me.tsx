import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Role } from "../../shared/roles";
import { api, ApiError } from "./api";

export type Me = {
  user: { id: string; email: string; name: string; phone: string | null };
  phoneVerified: boolean;
  workspace: { id: string; name: string; plan: string; onboardedAt: number | null; onboardingSkippedAt?: number | null } | null;
  role: Role | null;
  workspaces: { id: string; name: string; plan: string; role: Role }[];
};

type MeState = { me: Me | null; loading: boolean; refresh: () => Promise<Me | null> };
const MeContext = createContext<MeState>({ me: null, loading: true, refresh: async () => null });

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async (): Promise<Me | null> => {
    const request = ++generation.current;
    try {
      const current = await api.get<Me | null>("/auth/me", { redirectOn401: false });
      if (request !== generation.current) return null;
      setMe(current);
      return current;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
      if (request === generation.current) setMe(null);
      return null;
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <MeContext.Provider value={{ me, loading, refresh }}>{children}</MeContext.Provider>;
}

export const useMe = () => useContext(MeContext);
