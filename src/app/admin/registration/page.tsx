import { redirect } from "next/navigation";
import { getBrowserSession } from "@/lib/auth";
import { getRegistrationSettings } from "@/lib/db";
import { updateRegistrationSettingsAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export default async function RegistrationSettingsPage() {
  const session = await getBrowserSession();
  if (!session) redirect("/api/auth/signin");
  if (!session.user.isAdmin) redirect("/");
  const settings = getRegistrationSettings();

  return (
    <section className="mx-auto max-w-xl pt-12">
      <span className="eyebrow">Platform administration</span>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[--foreground]">Registration</h1>
      <p className="mt-2 text-sm text-[--foreground-muted]">
        Control whether new Google users can create their own OrbitTrack workspace.
        Existing users can always sign in.
      </p>
      <form action={updateRegistrationSettingsAction} className="glass-core mt-8 space-y-6 rounded-3xl p-6 ring-1 ring-[--border]">
        <label className="flex items-start gap-3 text-sm text-[--foreground]">
          <input name="registrationsOpen" type="checkbox" defaultChecked={settings.registrationsOpen} className="mt-0.5 h-4 w-4 accent-[--accent]" />
          <span><strong className="font-medium">Allow self-service registration</strong><br /><span className="text-[--foreground-muted]">Turn this off to stop new accounts immediately.</span></span>
        </label>
        <label className="block text-sm font-medium text-[--foreground]">
          Active account cap
          <input name="accountCap" type="number" min="0" max="10000" required defaultValue={settings.accountCap} className="mt-2 block w-full rounded-xl border border-[--border] bg-[--surface] px-3 py-2 text-[--foreground]" />
          <span className="mt-2 block text-xs font-normal text-[--foreground-muted]">{settings.activeAccountCount} of {settings.accountCap} non-administrator account slots are currently used.</span>
        </label>
        <Button type="submit" variant="primary">Save registration settings</Button>
      </form>
    </section>
  );
}
