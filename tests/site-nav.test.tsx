// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteNav } from "@/components/site-nav";

const { route } = vi.hoisted(() => ({ route: { pathname: "/" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("SiteNav", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    route.pathname = "/";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<SiteNav />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.style.overflow = "";
  });

  it("closes the mobile menu when the route changes", async () => {
    const menuButton = () =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle menu"]',
      )!;

    await act(async () => menuButton().click());
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    route.pathname = "/frontier";
    await act(async () => root.render(<SiteNav />));

    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    expect(document.body.style.overflow).toBe("");
  });

  it("links to agent credentials from desktop and mobile navigation", () => {
    const desktopLink = container.querySelector(
      'nav[aria-label="Primary navigation"] a[href="/settings/agents"]',
    );
    const mobileLink = container.querySelector(
      'nav[aria-label="Mobile navigation"] a[href="/settings/agents"]',
    );

    expect(desktopLink?.textContent).toContain("Agents");
    expect(mobileLink?.textContent).toContain("Agents");
  });

  it("marks agent credentials as the current page", async () => {
    route.pathname = "/settings/agents";
    await act(async () => root.render(<SiteNav />));

    const agentLinks = container.querySelectorAll(
      'a[href="/settings/agents"]',
    );
    expect(agentLinks).toHaveLength(2);
    for (const link of agentLinks) {
      expect(link.getAttribute("aria-current")).toBe("page");
    }

    const [desktopLink, mobileLink] = agentLinks;
    expect(
      desktopLink.querySelector('span[class*="bg-[var(--accent)]"]'),
    ).not.toBeNull();
    expect(mobileLink.className).toContain("text-[var(--accent)]");
  });
});
