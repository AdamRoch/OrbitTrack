"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Credential = { id: number; name: string; createdAt: number; revokedAt: number | null };

export function AgentCredentialManager() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [name, setName] = useState("my agent");
  const [newToken, setNewToken] = useState<string | null>(null);
  useEffect(() => { fetch("/api/agent-tokens").then((r) => r.json()).then(setCredentials).catch(() => {}); }, []);
  const create = async () => {
    const response = await fetch("/api/agent-tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const created = await response.json();
    if (response.ok) { setNewToken(created.token); setCredentials((current) => [{ id: created.id, name, createdAt: Date.now(), revokedAt: null }, ...current]); }
  };
  const revoke = async (id: number) => {
    if ((await fetch(`/api/agent-tokens/${id}`, { method: "DELETE" })).ok) setCredentials((current) => current.map((item) => item.id === id ? { ...item, revokedAt: Date.now() } : item));
  };
  return <section className="mx-auto max-w-xl pt-12"><span className="eyebrow">Workspace settings</span><h1 className="mt-3 text-3xl font-semibold text-[--foreground]">Agent credentials</h1><p className="mt-2 text-sm text-[--foreground-muted]">Create a token for each agent. OrbitTrack shows a token only once.</p><div className="glass-core mt-8 space-y-4 rounded-3xl p-6 ring-1 ring-[--border]"><input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-[--border] bg-[--surface] px-3 py-2" aria-label="Credential name" /><Button type="button" variant="primary" onClick={create}>Create credential</Button>{newToken && <div className="rounded-xl border border-[--accent] bg-[--surface] p-3"><p className="text-xs text-[--foreground-muted]">Copy this now. It will not be shown again.</p><code className="mt-2 block break-all text-sm text-[--foreground]">{newToken}</code></div>}</div><ul className="mt-6 space-y-2">{credentials.map((credential) => <li key={credential.id} className="flex items-center justify-between rounded-xl border border-[--border] p-3 text-sm"><span>{credential.name}{credential.revokedAt ? " (revoked)" : ""}</span>{!credential.revokedAt && <Button type="button" variant="ghost" size="sm" onClick={() => revoke(credential.id)}>Revoke</Button>}</li>)}</ul></section>;
}
