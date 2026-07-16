import { describe, it, expect } from "vitest";
import { createHarness } from "./harness";

const api = createHarness();

/**
 * UI smoke tests. The PRD only requires "a couple of smoke checks that pages
 * render with expected elements" — the data correctness is covered at the API.
 * These fetch the HTML and assert key elements are present.
 */
describe("UI smoke", () => {
  it("list page renders with nav, filter bar, and empty state", async () => {
    // Seed a label so the filter options aren't empty.
    await api.createLabel({ name: "smoke-label", color: "#22c55e" });

    const res = await api.fetch("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/OrbitTrack/);
    expect(html).toMatch(/Issues/);
    expect(html).toMatch(/New/);
    // Filter controls present.
    expect(html).toMatch(/name="status"|Status/);
    // The seeded label appears as a filter option.
    expect(html).toMatch(/smoke-label/);
  });

  it("detail page renders title, status, description, and dependency sections", async () => {
    const created = await api.createIssue({
      title: "Smoke detail",
      description: "## Heading\n\nbody text",
      status: "todo",
    });
    const res = await api.fetch(`/issues/${created.body.identifier}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Smoke detail/);
    expect(html).toMatch(new RegExp(created.body.identifier));
    // Rendered markdown (h2 from "## Heading").
    expect(html).toMatch(/<h2>Heading<\/h2>/);
    // Dependency sections present.
    expect(html).toMatch(/Blocked by|Blockers/);
    expect(html).toMatch(/Blocks/);
    // Edit/claim affordances.
    expect(html).toMatch(/Edit/);
  });

  it("new-issue page renders the create form", async () => {
    const res = await api.fetch("/new");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/New issue/);
    expect(html).toMatch(/name="title"/);
    expect(html).toMatch(/name="description"/);
    expect(html).toMatch(/name="status"/);
    expect(html).toMatch(/name="priority"/);
  });

  it("frontier page renders the frontier explainer", async () => {
    const res = await api.fetch("/frontier");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Frontier/);
    expect(html).toMatch(/\/api\/issues\/frontier/);
  });

  it("map page renders 200 and the graph shell is present", async () => {
    // The page may be in either state depending on whether earlier tests in
    // this file created issues: the empty state ("Nothing to map yet") or the
    // canvas (whose toolbar renders "Dependency graph"). The canvas itself is
    // a client island, but its initial markup is server-rendered — so we can
    // assert on the shell, same approach as the frontier smoke test.
    const res = await api.fetch("/map");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Nothing to map yet|Dependency graph/);
    // The nav entry is wired up.
    expect(html).toMatch(/href="\/map"/);
  });

  it("missing issue detail returns 404", async () => {
    const res = await api.fetch("/issues/LIN-88888");
    expect(res.status).toBe(404);
  });
});
