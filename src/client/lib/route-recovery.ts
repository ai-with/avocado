export function isChunkLoadFailure(error: unknown): boolean {
  try {
    if (!(error instanceof Error) || error.name === "AbortError") return false;
    return error.name === "ChunkLoadError" || (typeof error.message === "string" && /^(?:Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed)/i.test(error.message));
  } catch { return false; }
}

export type ReopenActions = { reload: () => void };

// Only a user click invokes reload. Native beforeunload handling stays intact;
// cancelling it never locks the action. No timer, storage or module side effect.
export function createPageRecovery(actions: ReopenActions | null) {
  return {
    available: actions !== null,
    reopen(): boolean {
      if (!actions) return false;
      try {
        actions.reload();
        return true;
      } catch {
        return false;
      }
    },
  };
}
