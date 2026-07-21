import { describe, it, expect } from "vitest";
import { createHarness } from "./harness";

const api = createHarness();

/**
 * Multi-project support — view-only scoping per project.
 *
 * Acceptance criteria covered here:
 *   - Projects are first-class: each has a unique prefix (key). Adding a new
 *     project is low-friction (POST /api/projects).
 *   - Prefixes on create: a ticket created under a project gets that
 *     project's prefix and its own per-project number sequence.
 *   - No cross-project leakage: a ticket resolves within its own project;
 *     you cannot read or mutate another project's ticket by identifier.
 */
describe("multi-project", () => {
  describe("GET /api/projects", () => {
    it("lists the default project bootstrapped on a fresh DB", async () => {
      const res = await api.listProjects();
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const def = res.body[0];
      expect(def.key).toBe("LIN");
      expect(def.name).toBe("LIN");
      expect(def.nextNumber).toBe(0);
      expect(typeof def.createdAt).toBe("string");
    });
  });

  describe("POST /api/projects", () => {
    it("creates a project with the given key and name", async () => {
      const res = await api.createProject({ key: "OEMR", name: "OpenEMR" });
      expect(res.status).toBe(201);
      expect(res.body.key).toBe("OEMR");
      expect(res.body.name).toBe("OpenEMR");
      expect(res.body.nextNumber).toBe(0);
    });

    it("normalizes the key to upper-case", async () => {
      const res = await api.createProject({ key: "af", name: "AgentForge" });
      expect(res.status).toBe(201);
      expect(res.body.key).toBe("AF");
      expect(res.body.name).toBe("AgentForge");
    });

    it("defaults name to the key when omitted", async () => {
      const res = await api.createProject({ key: "OT" });
      expect(res.status).toBe(201);
      expect(res.body.key).toBe("OT");
      expect(res.body.name).toBe("OT");
    });

    it("rejects a duplicate key (case-insensitive)", async () => {
      // LIN exists from the default bootstrap.
      const res = await api.createProject({ key: "lin", name: "lowercase" });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/already exists/i);
    });

    it("rejects an invalid key (digits / symbols / empty)", async () => {
      expect((await api.createProject({ key: "LIN1" })).status).toBe(400);
      expect((await api.createProject({ key: "WEB-1" })).status).toBe(400);
      expect((await api.createProject({ key: "" })).status).toBe(400);
      expect((await api.createProject({ key: "x".repeat(11) })).status).toBe(
        400,
      );
    });
  });

  describe("prefixes on create", () => {
    it("assigns the active project's prefix to new issues", async () => {
      const lin = await api.createIssue({ title: "lin-1" });
      expect(lin.body.identifier).toMatch(/^LIN-\d+$/);

      const oemr = await api.createIssue(
        { title: "oemr-1" },
        { projectKey: "OEMR" },
      );
      expect(oemr.body.identifier).toMatch(/^OEMR-\d+$/);
    });

    it("each project has its own per-project number sequence", async () => {
      // LIN already has issues from earlier tests in this file (lin-1).
      const linBefore = await api.listIssues(undefined, { projectKey: "LIN" });
      const oemrBefore = await api.listIssues(undefined, {
        projectKey: "OEMR",
      });

      // Create one in each.
      const a = await api.createIssue({ title: "x" }, { projectKey: "LIN" });
      const b = await api.createIssue({ title: "y" }, { projectKey: "OEMR" });

      // Both should be #N+1 within their own project's sequence.
      expect(a.body.number).toBe(linBefore.body.length + 1);
      expect(b.body.number).toBe(oemrBefore.body.length + 1);

      // And the identifiers reflect each project's prefix.
      expect(a.body.identifier).toBe(`LIN-${a.body.number}`);
      expect(b.body.identifier).toBe(`OEMR-${b.body.number}`);
    });

    it("does not reuse per-project numbers after deletes", async () => {
      const x = await api.createIssue({ title: "x" }, { projectKey: "OT" });
      const y = await api.createIssue({ title: "y" }, { projectKey: "OT" });
      const xNum = x.body.number;
      await api.deleteIssue(x.body.identifier, { projectKey: "OT" });
      const z = await api.createIssue({ title: "z" }, { projectKey: "OT" });
      expect(z.body.number).toBe(y.body.number + 1);
      expect(z.body.number).not.toBe(xNum);
    });

    it("returns 400 when the project scope doesn't exist", async () => {
      const res = await api.createIssue(
        { title: "x" },
        { projectKey: "NOPE" },
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("project_not_found");
    });
  });

  describe("no cross-project leakage", () => {
    it("GET by identifier returns 404 when the prefix doesn't match scope", async () => {
      const created = await api.createIssue(
        { title: "in OEMR" },
        { projectKey: "OEMR" },
      );
      expect(created.body.identifier).toMatch(/^OEMR-/);

      // Reading it from the LIN scope must be 404, not the OEMR issue body.
      const leaked = await api.getIssue(created.body.identifier, {
        projectKey: "LIN",
      });
      expect(leaked.status).toBe(404);

      // Reading from the right scope works.
      const ok = await api.getIssue(created.body.identifier, {
        projectKey: "OEMR",
      });
      expect(ok.status).toBe(200);
      expect(ok.body.identifier).toBe(created.body.identifier);
    });

    it("PATCH by identifier from the wrong scope is 404 (no mutation)", async () => {
      const created = await api.createIssue(
        { title: "original", status: "todo" },
        { projectKey: "OEMR" },
      );
      // Attempt to mutate from the LIN scope.
      const attempt = await api.patchIssue(
        created.body.identifier,
        { title: "hacked" },
        { projectKey: "LIN" },
      );
      expect(attempt.status).toBe(404);

      // The OEMR issue is untouched.
      const stillOriginal = await api.getIssue(created.body.identifier, {
        projectKey: "OEMR",
      });
      expect(stillOriginal.body.title).toBe("original");
    });

    it("DELETE by identifier from the wrong scope is 404 (no deletion)", async () => {
      const created = await api.createIssue(
        { title: "to keep" },
        { projectKey: "OEMR" },
      );
      const attempt = await api.deleteIssue(created.body.identifier, {
        projectKey: "LIN",
      });
      expect(attempt.status).toBe(404);

      const stillThere = await api.getIssue(created.body.identifier, {
        projectKey: "OEMR",
      });
      expect(stillThere.status).toBe(200);
    });

    it("numeric id resolution is scoped to the active project", async () => {
      // Create a LIN issue; capture its surrogate id.
      const lin = await api.createIssue({ title: "lin" });
      const linId = lin.body.id;

      // Reading that id from the OEMR scope must be 404.
      const leaked = await api.getIssue(String(linId), {
        projectKey: "OEMR",
      });
      expect(leaked.status).toBe(404);

      // Reading it from the LIN scope works.
      const ok = await api.getIssue(String(linId), { projectKey: "LIN" });
      expect(ok.status).toBe(200);
    });
  });

  describe("view switcher — list and frontier scope to the active project", () => {
    it("listIssues returns only issues in the active project", async () => {
      // Seed one issue in each of three projects.
      await api.createIssue({ title: "lin-only" }, { projectKey: "LIN" });
      await api.createIssue({ title: "oemr-only" }, { projectKey: "OEMR" });
      await api.createIssue({ title: "af-only" }, { projectKey: "AF" });

      const lin = await api.listIssues(undefined, { projectKey: "LIN" });
      const oemr = await api.listIssues(undefined, { projectKey: "OEMR" });
      const af = await api.listIssues(undefined, { projectKey: "AF" });

      // Every issue in `lin` has a LIN-* identifier; same for the others.
      expect(lin.body.every((i: { identifier: string }) => i.identifier.startsWith("LIN-"))).toBe(true);
      expect(oemr.body.every((i: { identifier: string }) => i.identifier.startsWith("OEMR-"))).toBe(true);
      expect(af.body.every((i: { identifier: string }) => i.identifier.startsWith("AF-"))).toBe(true);

      // And specifically, oemr-only is in oemr but not in lin.
      expect(oemr.body.some((i: { title: string }) => i.title === "oemr-only")).toBe(true);
      expect(lin.body.some((i: { title: string }) => i.title === "oemr-only")).toBe(false);
    });

    it("frontier respects the project scope", async () => {
      // Two ready issues (todo, no blockers), one per project.
      await api.createIssue(
        { title: "ready-lin", status: "todo" },
        { projectKey: "LIN" },
      );
      await api.createIssue(
        { title: "ready-oemr", status: "todo" },
        { projectKey: "OEMR" },
      );

      const linFrontier = await api.frontier({ projectKey: "LIN" });
      const oemrFrontier = await api.frontier({ projectKey: "OEMR" });

      expect(
        linFrontier.body.every((i: { identifier: string }) =>
          i.identifier.startsWith("LIN-"),
        ),
      ).toBe(true);
      expect(
        oemrFrontier.body.every((i: { identifier: string }) =>
          i.identifier.startsWith("OEMR-"),
        ),
      ).toBe(true);
    });
  });

  describe("cross-project dependencies are rejected", () => {
    it("addBlocker refuses to link issues across projects", async () => {
      const lin = await api.createIssue({ title: "lin" }, { projectKey: "LIN" });
      // The blocker also has to resolve in the LIN scope; an OEMR identifier
      // won't even resolve there (cross-project leak prevention), so this is
      // naturally a 404 ("issue not found"). Both directions are covered: the
      // scoped resolver refuses identifiers from other projects, so a cross-
      // project edge can never be created.
      const attempt = await api.addBlocker(
        lin.body.identifier,
        "OEMR-1",
        { projectKey: "LIN" },
      );
      expect(attempt.status).toBe(404);
    });
  });

  describe("default project (no ?project=) is backward-compatible", () => {
    it("operations without ?project= run against the LIN default", async () => {
      // No projectKey passed at all.
      const created = await api.createIssue({ title: "default" });
      expect(created.body.identifier).toMatch(/^LIN-/);

      const got = await api.getIssue(created.body.identifier);
      expect(got.status).toBe(200);
      expect(got.body.identifier).toBe(created.body.identifier);
    });
  });
});
