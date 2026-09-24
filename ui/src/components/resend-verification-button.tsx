import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button } from "@/components";

export function ResendVerificationButton({
  email,
  callbackURL,
  label,
  size,
}: {
  email: string | null;
  callbackURL: string;
  label: string;
  size?: "sm";
}) {
  const authClient = useAuthClient();
  const resend = useMutation({
    mutationFn: async () => {
      if (!email) throw new Error("Add an email first");
      const { error } = await authClient.sendVerificationEmail({ email, callbackURL });
      if (error) throw new Error(error.message ?? "Could not send the email");
    },
    onSuccess: () => toast.success(`Verification email sent to ${email}`),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Button
      size={size}
      variant="outline"
      onClick={() => resend.mutate()}
      disabled={resend.isPending}
    >
      {resend.isPending ? "sending..." : label}
    </Button>
  );
}
