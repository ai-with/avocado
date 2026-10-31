export type InstagramConnectionStatus = "connected" | "not_connected" | "expired" | "token_missing" | "provider_auth_invalid" | "manual" | "grant_unverified" | "permissions_missing" | "not_professional";
export type PublicInstagramLink = { configured: boolean; status: InstagramConnectionStatus; connected: boolean; username: string | null; connectUrl: string };
