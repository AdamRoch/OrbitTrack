import { getBrowserSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AgentCredentialManager } from "@/app/settings/agents/manager";

export default async function AgentSettingsPage() {
  if (!await getBrowserSession()) redirect("/api/auth/signin");
  return <AgentCredentialManager />;
}
