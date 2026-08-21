import { SiteNav } from "@/components/site-nav";
import { getBrowserSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getBrowserSession())) redirect("/signin");

  return (
    <>
      <SiteNav />
      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pt-24 pb-16">
        {children}
      </main>
    </>
  );
}
