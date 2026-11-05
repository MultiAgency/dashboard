import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/platform/wallet-check")({
  beforeLoad: () => {
    if (process.env.NODE_ENV !== "development") throw notFound();
  },
  head: () => ({
    meta: [{ title: "Wallet check | Admin" }],
  }),
  component:
    process.env.NODE_ENV === "development"
      ? lazyRouteComponent(() => import("@/components/wallet-check"), "WalletCheck")
      : () => null,
});
