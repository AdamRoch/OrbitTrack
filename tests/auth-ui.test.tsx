// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInWithGoogleButton } from "@/components/auth-buttons";
import { authOptions } from "@/lib/auth";

const { provisionGoogleUser, signIn } = vi.hoisted(() => ({
  provisionGoogleUser: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ signIn, signOut: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return { ...actual, provisionGoogleUser };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("browser authentication UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    provisionGoogleUser.mockReset();
    signIn.mockReset();
    signIn.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<SignInWithGoogleButton />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("routes Auth.js through OrbitTrack's sign-in page", () => {
    expect(authOptions.pages).toEqual({ signIn: "/signin", error: "/signin" });
  });

  it("starts Google sign-in and returns to the ticket list", async () => {
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("Sign in with Google");
    expect(button.querySelector("svg")).not.toBeNull();

    await act(async () => button.click());
    expect(signIn).toHaveBeenCalledWith("google", { callbackUrl: "/" });
  });

  it.each([
    ["full", "/signin?error=RegistrationFull"],
    ["closed", "/signin?error=RegistrationClosed"],
  ] as const)("routes a %s registration denial through the branded page", async (kind, destination) => {
    provisionGoogleUser.mockReturnValue({ kind });
    const callback = authOptions.callbacks?.signIn;
    expect(callback).toBeDefined();

    const result = await callback!({
      user: { id: "pending-user" },
      account: { provider: "google", providerAccountId: "google-subject", type: "oauth" },
      profile: { email: "new@example.test", email_verified: true },
      email: { verificationRequest: false },
      credentials: undefined,
    });

    expect(result).toBe(destination);
  });
});
