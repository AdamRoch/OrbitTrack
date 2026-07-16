"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createIssue,
  updateIssue,
  deleteIssue,
  claimIssue,
  addBlocker,
  removeBlocker,
  setIssueLabels,
  createLabel,
  deleteLabel,
} from "@/lib/domain";
import { getServerDb } from "@/lib/server-data";
import {
  ValidationError,
  optionalDescription,
  parseLabelNames,
  parseOptionalPriority,
  parseOptionalStatus,
  parsePriority,
  parseStatus,
  requireTitle,
  parseColor,
  parseLabelName,
} from "@/lib/validate";

/**
 * Server actions — the UI's mutation seam. They go through the same domain
 * layer as the REST API, so the rules are shared. On validation failure they
 * return a `{ ok: false, error }` object the form can display; on success they
 * return `{ ok: true }` (and revalidate routes, or redirect for creates).
 *
 * Every action shares one return shape so `useActionState` typings line up
 * uniformly across forms. Creates additionally carry `identifier` so the
 * client can navigate to the new issue's detail page.
 */
export interface ActionResult {
  ok: boolean;
  error?: string;
  identifier?: string;
}

function fail(message: string): ActionResult {
  return { ok: false, error: message };
}

function isRedirectError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    typeof (e as { digest: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

// ---- Issues ----

export async function createIssueAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const db = getServerDb();
  try {
    const title = requireTitle(formData.get("title"));
    const description = optionalDescription(formData.get("description"));
    const status = parseOptionalStatus(formData.get("status") || undefined);
    const priority = parseOptionalPriority(formData.get("priority") || undefined);
    const labelNames = parseLabelNames(
      (formData.getAll("labelNames") as string[]).filter(Boolean),
    );
    const issue = createIssue(db, {
      title,
      description,
      status,
      priority,
      labelNames,
    });
    revalidatePath("/");
    revalidatePath("/frontier");
    redirect(`/issues/${issue.identifier}`);
  } catch (e) {
    if (e instanceof ValidationError) return fail(e.message);
    if (isRedirectError(e)) throw e; // redirect() must propagate
    throw e;
  }
}

export async function updateIssueAction(
  identifier: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const db = getServerDb();
  try {
    const args: Parameters<typeof updateIssue>[2] = {};
    const title = formData.get("title");
    if (title !== null) args.title = requireTitle(title);
    const description = formData.get("description");
    if (description !== null) args.description = optionalDescription(description);
    const status = formData.get("status");
    if (status !== null) args.status = parseStatus(status as string);
    const priority = formData.get("priority");
    if (priority !== null) args.priority = parsePriority(priority as string);

    const updated = updateIssue(db, identifier, args);
    if (!updated) return fail("issue not found");
    revalidatePath(`/issues/${identifier}`);
    revalidatePath("/");
    revalidatePath("/frontier");
    return { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return fail(e.message);
    throw e;
  }
}

export async function deleteIssueAction(
  identifier: string,
  _prev: ActionResult,
  _formData?: FormData,
): Promise<ActionResult> {
  const db = getServerDb();
  const ok = deleteIssue(db, identifier);
  if (!ok) return fail("issue not found");
  revalidatePath("/");
  revalidatePath("/frontier");
  redirect("/");
}

export async function claimIssueAction(
  identifier: string,
  _prev: ActionResult,
  _formData?: FormData,
): Promise<ActionResult> {
  const db = getServerDb();
  const result = claimIssue(db, identifier);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return fail("issue not found");
    }
    if (result.reason === "blocked") {
      return fail("issue is blocked by unfinished work");
    }
    return fail(`cannot claim an issue with status "${result.status}"`);
  }
  revalidatePath(`/issues/${identifier}`);
  revalidatePath("/");
  revalidatePath("/frontier");
  return { ok: true };
}

export async function setIssueLabelsAction(
  identifier: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const db = getServerDb();
  try {
    const labelNames = (formData.getAll("labelNames") as string[]).filter(
      Boolean,
    );
    const updated = setIssueLabels(db, identifier, labelNames);
    if (!updated) return fail("issue not found");
    revalidatePath(`/issues/${identifier}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return fail(e.message);
    throw e;
  }
}

// ---- Dependencies ----

export async function addBlockerAction(
  identifier: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const db = getServerDb();
  try {
    const blockerId = formData.get("blockerId") as string;
    if (!blockerId || !blockerId.trim()) {
      return fail("blocker id or identifier is required");
    }
    const result = addBlocker(db, identifier, blockerId.trim());
    if (result === null) return fail("issue not found");
    revalidatePath(`/issues/${identifier}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return fail(e.message);
    throw e;
  }
}

export async function removeBlockerAction(
  identifier: string,
  blockerId: string,
  _prev: ActionResult,
  _formData?: FormData,
): Promise<ActionResult> {
  const db = getServerDb();
  const result = removeBlocker(db, identifier, blockerId);
  if (result === null) return fail("issue not found");
  if (result === false) return fail("dependency edge not found");
  revalidatePath(`/issues/${identifier}`);
  return { ok: true };
}

// ---- Labels ----

export async function createLabelAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const db = getServerDb();
  try {
    const name = parseLabelName(formData.get("name"));
    const color = parseColor(formData.get("color") || undefined);
    createLabel(db, { name, color });
    revalidatePath("/");
    revalidatePath("/labels");
    return { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return fail(e.message);
    throw e;
  }
}

export async function deleteLabelAction(
  id: number,
  _prev: ActionResult,
  _formData?: FormData,
): Promise<ActionResult> {
  const db = getServerDb();
  const ok = deleteLabel(db, id);
  if (!ok) return fail("label not found");
  revalidatePath("/");
  revalidatePath("/labels");
  return { ok: true };
}
