import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

const HASH_MESSAGES: Record<string, string> = {
  unauthorized: "Sign in with a NEAR wallet that has access to this area.",
  "not-a-client":
    "No client portal for this wallet. Ask your agency to add your NEAR account under Admin → Clients.",
};

export function AuthHashToasts() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash || !HASH_MESSAGES[hash]) return;

    toast.error(HASH_MESSAGES[hash]!);
    void router.navigate({ to: ".", hash: undefined, replace: true });
  }, [router]);

  return null;
}
