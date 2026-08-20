import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing ${name}`);
  return resolve(value);
}

function usage(): never {
  throw new Error("usage: workspace-state <export|import|verify> --source <db> [--out <json>|--destination <db>]");
}

async function main(): Promise<void> {
  // Next loads .env.local for the app. This command runs outside Next, so load
  // the same configuration before importing database code that reads it.
  loadEnvConfig(process.cwd());
  const { exportWorkspaceState, importWorkspaceState, verifyWorkspaceState } = await import("../src/lib/workspace-state");
  const command = process.argv[2];
  if (command === "export") {
    const out = option("--out");
    const artifact = exportWorkspaceState(option("--source"));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ artifact: out, integrity: artifact.integrity, counts: artifact.source.tableCounts }));
  } else if (command === "import") {
    const artifact = JSON.parse(readFileSync(option("--source"), "utf8"));
    const imported = importWorkspaceState(option("--destination"), artifact);
    console.log(JSON.stringify({ integrity: imported.integrity, counts: imported.source.tableCounts }));
  } else if (command === "verify") {
    const result = verifyWorkspaceState(option("--source"), option("--destination"));
    const outIndex = process.argv.indexOf("--out");
    if (outIndex !== -1) {
      const out = option("--out");
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    }
    console.log(JSON.stringify(result));
  } else {
    usage();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "workspace-state failed");
  process.exitCode = 1;
});
