import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterAll, beforeAll } from "vitest";

/**
 * Black-box HTTP test harness.
 *
 * Boots a real Next.js dev server on a random port, pointed at a throwaway
 * SQLite file in a temp dir. Exposes a `fetch`-style helper plus typed sugar
 * for the agent API. The server is shared across tests in a file; a fresh DB
 * means every file starts from a known-empty state.
 *
 * We boot Next in dev mode rather than via a custom server so the route
 * handlers run through the real App Router pipeline — which is what we want
 * to exercise (it's the agent contract).
 */

export interface Harness {
  base: string;
  dbPath: string;
  /** Raw fetch prebound to the test server base URL. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  // ---- Typed sugar for the common operations tests use ----
  createIssue: (
    body: Record<string, unknown>,
  ) => Promise<{ status: number; body: any }>;
  getIssue: (id: string) => Promise<{ status: number; body: any }>;
  frontier: () => Promise<{ status: number; body: any }>;
  listIssues: (qs?: string) => Promise<{ status: number; body: any }>;
  claim: (id: string) => Promise<{ status: number; body: any }>;
  patchIssue: (
    id: string,
    body: Record<string, unknown>,
  ) => Promise<{ status: number; body: any }>;
  deleteIssue: (id: string) => Promise<{ status: number }>;
  setLabels: (
    id: string,
    labelNames: string[],
  ) => Promise<{ status: number; body: any }>;
  listLabels: () => Promise<{ status: number; body: any }>;
  createLabel: (
    body: Record<string, unknown>,
  ) => Promise<{ status: number; body: any }>;
  deleteLabel: (id: number) => Promise<{ status: number }>;
  addBlocker: (
    id: string,
    blockerId: string | number,
  ) => Promise<{ status: number; body: any }>;
  removeBlocker: (id: string, blockerId: string) => Promise<{ status: number }>;
  getBlockers: (id: string) => Promise<{ status: number; body: any }>;
  addQuestion: (
    id: string,
    question: string,
  ) => Promise<{ status: number; body: any }>;
  getQuestions: (id: string) => Promise<{ status: number; body: any }>;
  respond: (
    id: string,
    number: number,
    answer: string,
  ) => Promise<{ status: number; body: any }>;
  openQuestions: (qs?: string) => Promise<{ status: number; body: any }>;
}

async function jsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Create a harness shared across all tests in a file. Call this at module
 * scope in a test file; it wires beforeAll/afterAll for you.
 */
export function createHarness(): Harness {
  let proc: ChildProcess | null = null;
  let base = "";
  let dbPath = "";

  const impl: Harness = {
    base: "",
    dbPath: "",
    fetch: () => {
      throw new Error("not booted");
    },
    createIssue: async () => ({ status: 0, body: null }),
    getIssue: async () => ({ status: 0, body: null }),
    frontier: async () => ({ status: 0, body: null }),
    listIssues: async () => ({ status: 0, body: null }),
    claim: async () => ({ status: 0, body: null }),
    patchIssue: async () => ({ status: 0, body: null }),
    deleteIssue: async () => ({ status: 0 }),
    setLabels: async () => ({ status: 0, body: null }),
    listLabels: async () => ({ status: 0, body: null }),
    createLabel: async () => ({ status: 0, body: null }),
    deleteLabel: async () => ({ status: 0 }),
    addBlocker: async () => ({ status: 0, body: null }),
    removeBlocker: async () => ({ status: 0 }),
    getBlockers: async () => ({ status: 0, body: null }),
    addQuestion: async () => ({ status: 0, body: null }),
    getQuestions: async () => ({ status: 0, body: null }),
    respond: async () => ({ status: 0, body: null }),
    openQuestions: async () => ({ status: 0, body: null }),
  };

  const doFetch = async (path: string, init?: RequestInit): Promise<Response> => {
    const url = path.startsWith("http") ? path : `${base}${path}`;
    return fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  };

  const sugar = {
    createIssue: async (body: Record<string, unknown>) => {
      const res = await doFetch("/api/issues", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await jsonResponse(res) };
    },
    getIssue: async (id: string) => {
      const res = await doFetch(`/api/issues/${id}`);
      return { status: res.status, body: await jsonResponse(res) };
    },
    frontier: async () => {
      const res = await doFetch("/api/issues/frontier");
      return { status: res.status, body: await jsonResponse(res) };
    },
    listIssues: async (qs = "") => {
      const res = await doFetch(`/api/issues${qs}`);
      return { status: res.status, body: await jsonResponse(res) };
    },
    claim: async (id: string) => {
      const res = await doFetch(`/api/issues/${id}/claim`, { method: "POST" });
      return { status: res.status, body: await jsonResponse(res) };
    },
    patchIssue: async (id: string, body: Record<string, unknown>) => {
      const res = await doFetch(`/api/issues/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await jsonResponse(res) };
    },
    deleteIssue: async (id: string) => {
      const res = await doFetch(`/api/issues/${id}`, { method: "DELETE" });
      return { status: res.status };
    },
    setLabels: async (id: string, labelNames: string[]) => {
      const res = await doFetch(`/api/issues/${id}/labels`, {
        method: "PUT",
        body: JSON.stringify({ labelNames }),
      });
      return { status: res.status, body: await jsonResponse(res) };
    },
    listLabels: async () => {
      const res = await doFetch("/api/labels");
      return { status: res.status, body: await jsonResponse(res) };
    },
    createLabel: async (body: Record<string, unknown>) => {
      const res = await doFetch("/api/labels", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await jsonResponse(res) };
    },
    deleteLabel: async (id: number) => {
      const res = await doFetch(`/api/labels/${id}`, { method: "DELETE" });
      return { status: res.status };
    },
    addBlocker: async (id: string, blockerId: string | number) => {
      const res = await doFetch(`/api/issues/${id}/blockers`, {
        method: "POST",
        body: JSON.stringify({ blockerId }),
      });
      return { status: res.status, body: await jsonResponse(res) };
    },
    removeBlocker: async (id: string, blockerId: string) => {
      const res = await doFetch(`/api/issues/${id}/blockers/${blockerId}`, {
        method: "DELETE",
      });
      return { status: res.status };
    },
    getBlockers: async (id: string) => {
      const res = await doFetch(`/api/issues/${id}/blockers`);
      return { status: res.status, body: await jsonResponse(res) };
    },
    addQuestion: async (id: string, question: string) => {
      const res = await doFetch(`/api/issues/${id}/questions`, {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      return { status: res.status, body: await jsonResponse(res) };
    },
    getQuestions: async (id: string) => {
      const res = await doFetch(`/api/issues/${id}/questions`);
      return { status: res.status, body: await jsonResponse(res) };
    },
    respond: async (id: string, number: number, answer: string) => {
      const res = await doFetch(`/api/issues/${id}/questions/${number}/respond`, {
        method: "POST",
        body: JSON.stringify({ answer }),
      });
      return { status: res.status, body: await jsonResponse(res) };
    },
    openQuestions: async (qs = "") => {
      const res = await doFetch(`/api/questions${qs}`);
      return { status: res.status, body: await jsonResponse(res) };
    },
  };

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "lc-test-"));
    dbPath = join(dir, "test.db");
    const port = await freePort();

    proc = spawn(
      "npx",
      ["next", "dev", "-p", String(port)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRACKER_DB_PATH: dbPath,
          // Disable seeding by default so each file starts truly empty and
          // opts into labels explicitly. Tests that want seed data can create
          // labels via the API.
          TRACKER_SEED: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    base = `http://127.0.0.1:${port}`;
    impl.base = base;
    impl.dbPath = dbPath;
    impl.fetch = doFetch;
    Object.assign(impl, sugar);

    // Wait for the server to be ready by polling the issues endpoint.
    const ready = await waitFor(base + "/api/issues", 45_000);
    if (!ready) {
      const err = await readStderr(proc);
      throw new Error(`Next dev server did not become ready.\n${err}`);
    }
  }, 60_000);

  afterAll(async () => {
    if (proc) {
      proc.kill("SIGTERM");
      // Give it a moment, then force.
      await new Promise((r) => setTimeout(r, 500));
      if (!proc.killed) proc.kill("SIGKILL");
    }
    if (dbPath) {
      const dir = dbPath.replace(/\/[^/]+$/, "");
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  return impl;
}

async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function readStderr(proc: ChildProcess | null): Promise<string> {
  if (!proc?.stderr) return "";
  let out = "";
  proc.stderr.on("data", (d) => (out += d.toString()));
  await new Promise((r) => setTimeout(r, 1000));
  return out.slice(-3000);
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => res(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
}
