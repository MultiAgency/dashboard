import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

const HASH_MESSAGES: Record<string, string> = {
  unauthorized: "Sign in with an account that has access to this area.",
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
