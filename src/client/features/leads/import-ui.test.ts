// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportModal } from "./sections/ImportModal";
import { fileFingerprint, mappedRows, readImportFile, resolveImport, UNMAPPED } from "./import-upload";
import { IMPORT_FILE_BYTES, type ImportJob } from "../../../shared/lead-imports";

const NOW = Date.parse("2026-11-01T00:00:00Z");
let root: Root, container: HTMLDivElement;
let calls: { path: string; method: string; body: Record<string, unknown> }[], jobs: Map<string, ImportJob>;
let handle: (path: string, init?: RequestInit) => Promise<Response>;
const changed = vi.fn(), closed = vi.fn();
const context = { scope: "a".repeat(64), csrfToken: "local-csrf", serverTime: NOW };
beforeEach(async () => {
  const module = await import("node:crypto" as string) as { webcrypto: Crypto }; vi.stubGlobal("crypto", module.webcrypto);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); calls = []; jobs = new Map(); changed.mockReset(); closed.mockReset();
  handle = async (path, init) => {
    if (path.endsWith("/context")) return Response.json(context);
    if (path.endsWith("/jobs") && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as { requestId: string; fingerprint: string; totalRows: number };
      const job: ImportJob = { id: input.requestId, generation: "local-generation", fingerprint: input.fingerprint, totalRows: input.totalRows, status: "active", nextChunk: 0, processed: 0, imported: 0, invalid: 0, skipped: 0, expiresAt: NOW + 86_400_000 };
      jobs.set(job.id, job); return Response.json(job);
    }
    const id = path.split("/jobs/")[1]?.split("/")[0] ?? "", job = jobs.get(id);
    if (!job) return Response.json({ error: { code: "import_not_found", message: "not found" } }, { status: 404 });
    if (path.endsWith("/chunks")) {
      const input = JSON.parse(String(init?.body)) as { rows: unknown[]; chunkNo: number };
      job.processed += input.rows.length; job.imported += input.rows.length; job.nextChunk++;
      if (job.processed === job.totalRows) job.status = "completed";
      return Response.json({ chunkNo: input.chunkNo, imported: input.rows.length, invalid: [], skipped: [], job });
    }
    if (path.endsWith("/cancel")) { job.status = "cancelled"; job.generation = "cancelled-generation"; return Response.json(job); }
    return Response.json(job);
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input); calls.push({ path, method: init?.method ?? "GET", body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    expect(init?.credentials).toBe("same-origin"); expect(init?.signal).toBeDefined();
    return handle(path, init);
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const csv = (count: number) => new File(["email,name,marketing_opt_in\n" + Array.from({ length: count }, (_, i) => `local-${i}@example.invalid,LOCAL,yes`).join("\n")], "LOCAL.csv", { type: "text/csv" });
async function show() { await act(async () => root.render(h(ImportModal, { onClose: closed, onDone: changed }))); }
async function pick(file = csv(1)) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await vi.waitFor(() => expect(container.textContent).toContain("이메일 (필수)"));
}
async function check() { await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); }
const action = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => /가져오기 ·|같은 파일로 이어서|새 작업 시작/.test(button.textContent ?? ""))!;
async function click() { await act(async () => action().click()); }

describe("CSV import consent, progress and resumable intent", () => {
  it("keeps unchecked/missing mapping disabled and rejects client consent bypass with no mutation", async () => {
    await show(); expect(action().disabled).toBe(true); await pick(); expect(action().disabled).toBe(true);
    await click(); await expect(resolveImport(context, "b".repeat(64), 1, false)).rejects.toThrow();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    await check(); expect(action().disabled).toBe(false);
    await act(async () => { action().click(); action().click(); });
    await vi.waitFor(() => expect(jobs.size).toBe(1));
    await vi.waitFor(() => expect(container.textContent).toContain("1 / 1행 처리"));
    expect(calls.filter((call) => call.path.endsWith("/chunks"))).toHaveLength(1);
    expect(action().disabled).toBe(true); // New intent requires consent again.
  });
  it("after lost response, same-file reselection resumes the existing job without a new ID or repeating completed rows", async () => {
    const original = handle; let lost = false;
    handle = async (path, init) => { const response = await original(path, init); if (path.endsWith("/chunks") && !lost) { lost = true; throw new Error("local response lost"); } return response; };
    await show(); await pick(csv(150)); await check(); await click();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("완료 응답"));
    expect(calls.filter((call) => call.path.endsWith("/chunks"))).toHaveLength(1);
    const id = [...jobs.keys()][0]!;
    expect(localStorage.length).toBe(1); expect(localStorage.getItem(localStorage.key(0)!)).not.toMatch(/@|LOCAL.csv|LOCAL/);
    await act(async () => root.unmount()); root = createRoot(container); await show(); await pick(csv(150)); await check(); await click();
    await vi.waitFor(() => expect(container.textContent).toContain("150 / 150행 처리"));
    expect([...jobs.keys()]).toEqual([id]);
    expect(calls.filter((call) => call.path.endsWith("/jobs") && call.method === "POST")).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith("/chunks")).map((call) => call.body.chunkNo)).toEqual([0, 1]);
  });
  it("unknown lookup does not create a new job automatically", async () => {
    const original = handle; handle = async (path, init) => path.includes("/jobs/") ? Response.json({ error: { code: "unavailable", message: "LOCAL unknown" } }, { status: 503 }) : original(path, init);
    await show(); await pick(); await check(); await click();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("LOCAL unknown"));
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0); expect(localStorage.length).toBe(1);
  });
  it("workspace/session scope changes stop before job creation", async () => {
    await show(); await pick(); await check();
    const original = handle; handle = async (path, init) => path.endsWith("/context") ? Response.json({ ...context, scope: "b".repeat(64) }) : original(path, init);
    await click(); expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("워크스페이스가 바뀌었어요");
  });
  it("cancel stops after the in-flight chunk and displays partial completion", async () => {
    const original = handle; let release!: () => void;
    handle = async (path, init) => {
      if (path.endsWith("/chunks")) await new Promise<void>((resolve) => { release = resolve; });
      return original(path, init);
    };
    await show(); await pick(csv(150)); await check();
    await act(async () => action().click());
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "현재 묶음 뒤 중단")!.click());
    await act(async () => release());
    await vi.waitFor(() => expect(container.textContent).toContain("가져오기를 중단했어요"));
    expect(container.textContent).toContain("100 / 150행 처리");
    expect(calls.filter((call) => call.path.endsWith("/chunks"))).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith("/cancel"))).toHaveLength(1);
  });
  it("preserves BOM/quoted values and binds mapping to fingerprint", async () => {
    const selected = await readImportFile(new File(['\ufeffemail,name\r\nlocal@example.invalid,"A, B"\r\n'], "LOCAL.csv"));
    const map = { ...UNMAPPED, email: 0, name: 1 };
    expect(mappedRows(selected.rows, map)).toEqual([{ email: "local@example.invalid", name: "A, B" }]);
    expect(await fileFingerprint(selected, map)).not.toBe(await fileFingerprint(selected, { ...map, name: -1 }));
    await expect(readImportFile(new File(['email,name\nlocal@example.invalid,"unclosed'], "LOCAL.csv"))).rejects.toThrow("따옴표");
    const arrayBuffer = vi.fn(); await expect(readImportFile({ size: IMPORT_FILE_BYTES + 1, arrayBuffer } as unknown as File)).rejects.toThrow("16MB"); expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it("an explicit stop still cancels metadata after the in-flight chunk commits but loses its response", async () => {
    const original = handle; let release!: () => void;
    handle = async (path, init) => {
      if (path.endsWith("/chunks")) { await new Promise<void>((resolve) => { release = resolve; }); await original(path, init); throw new Error("local response lost"); }
      return original(path, init);
    };
    await show(); await pick(csv(150)); await check(); await act(async () => action().click());
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "현재 묶음 뒤 중단")!.click());
    await act(async () => release());
    await vi.waitFor(() => expect(container.textContent).toContain("가져오기를 중단했어요"));
    expect(container.textContent).toContain("100 / 150행 처리");
    expect(calls.filter((call) => call.path.endsWith("/chunks"))).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith("/cancel"))).toHaveLength(1);
  });
  it("invalid new file clears the old selected contacts and consent", async () => {
    await show(); await pick(); await check(); expect(action().disabled).toBe(false);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["not contacts"], "INVALID.csv")], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await vi.waitFor(() => expect(action().disabled).toBe(true));
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
});
