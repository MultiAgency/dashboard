import { Outlet, useRouter } from "@tanstack/react-router";
import { AppNotFound, AppRouteError, Shell } from "@/components/shell";

export const shellHead = () => ({ meta: [{ name: "theme-color", content: "#ffff33" }] });

export function ShellLayout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

export function ShellNotFound() {
  return (
    <Shell>
      <AppNotFound />
    </Shell>
  );
}

export function ShellError({ reset }: { reset: () => void }) {
  const router = useRouter();
  return (
    <Shell>
      <AppRouteError
        onRetry={() => {
          reset();
          void router.invalidate();
        }}
      />
    </Shell>
  );
}
