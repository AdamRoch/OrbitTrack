// @vitest-environment jsdom
/**
 * Component test for the new-ticket form's inline project creation.
 *
 * Regression: the create-project popover used to render a <form> inside the
 * new-ticket <form> — invalid HTML that real browsers handle inconsistently,
 * so Create could swallow the submission and the new project never appeared
 * in the picker. The popover is now a plain panel; these tests drive the
 * real NewIssueForm in jsdom and assert the whole flow.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NewIssueForm } from "@/app/new/new-issue-form";
import type { ProjectDTO } from "@/lib/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const existing: ProjectDTO = {
  id: 1,
  key: "LIN",
  name: "Linear",
  nextNumber: 1,
  createdAt: "2026-07-28T00:00:00.000Z",
};
const created: ProjectDTO = {
  id: 2,
  key: "ZZ",
  name: "Zeta Zone",
  nextNumber: 1,
  createdAt: "2026-07-28T00:00:00.000Z",
};

/** Set a controlled input's value the way React expects (native setter). */
function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("new-ticket inline project creation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  const mount = async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(
        <NewIssueForm labels={[]} projects={[existing]} projectKey="LIN" />,
      );
    });
  };

  const openPopover = async () => {
    const select = container.querySelector<HTMLSelectElement>(
      'select[name="projectKey"]',
    )!;
    select.value = "__new__";
    await act(async () => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return select;
  };

  const keyInput = () =>
    container.querySelector<HTMLInputElement>('input[placeholder="ORBT"]')!;
  const createButton = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === "Create",
    )!;

  beforeEach(async () => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await mount();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  it("creates the project via the Create button and selects it in the picker", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const select = await openPopover();
    setInputValue(keyInput(), "zz");
    setInputValue(
      container.querySelector<HTMLInputElement>(
        'input[placeholder="Defaults to the key"]',
      )!,
      "Zeta Zone",
    );

    await act(async () => {
      createButton().click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["LIN", "ZZ", "__new__"]);
    expect(select.value).toBe("ZZ");
    // Popover closed.
    expect(container.querySelector('input[placeholder="ORBT"]')).toBeNull();
    // The nested-form warning must not come back (other console.error noise
    // like act() hints is fine).
    const logged = consoleError.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(
      logged.some((m: string) => m.includes("cannot be a descendant of <form>")),
    ).toBe(false);
  });

  it("creates the project via the Enter key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const select = await openPopover();
    setInputValue(keyInput(), "zz");

    await act(async () => {
      keyInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(select.value).toBe("ZZ");
  });

  it("rejects an invalid key inline without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await openPopover();
    setInputValue(keyInput(), "not a key!");

    await act(async () => {
      createButton().click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/Key must be 1–10 letters/);
    // Popover stays open so the user can fix the key.
    expect(container.querySelector('input[placeholder="ORBT"]')).not.toBeNull();
  });
});
