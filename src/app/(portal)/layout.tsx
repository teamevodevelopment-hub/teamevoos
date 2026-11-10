import { Suspense } from "react";
import { PortalProvider } from "@/components/PortalProvider";
import { Shell } from "@/components/Shell";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="loadingshell">Loading…</div>}>
      <PortalProvider>
        <Shell>{children}</Shell>
      </PortalProvider>
    </Suspense>
  );
}
