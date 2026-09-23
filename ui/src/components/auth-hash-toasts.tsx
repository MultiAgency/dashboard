import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

const HASH_MESSAGES: Record<string, string> = {
  unauthorized: "Your account does not have access to this area.",
  "organization-required":
    "Select or create an Agency Organization from the header to open the Agency dashboard.",
  "not-a-client": "This Organization has no Client Engagement. Ask an Agency admin to propose one.",
};

export function AuthHashToasts() {
  const router = useRouter();
  const hash = useLocation({ select: (location) => location.hash });

  useEffect(() => {
    const message = HASH_MESSAGES[hash.replace(/^#/, "")];
    if (!message) return;

    toast.error(message);
    void router.navigate({ to: ".", hash: undefined, replace: true });
  }, [hash, router]);

  return null;
}
