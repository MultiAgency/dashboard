import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAuthClient } from "@/app";
import { sessionQueryOptions } from "@/lib/auth";

export function OperatorHint({ children }: { children: ReactNode }) {
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  if (session?.user?.role === "admin") return <>{children}</>;
  return <>Ask your server admin to turn this on.</>;
}
