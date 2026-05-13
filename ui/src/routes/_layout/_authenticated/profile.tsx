import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Avatar, AvatarFallback, AvatarImage, Button, Card, CardContent } from "@/components";
import { Field } from "@/components/admin-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { sessionQueryKey, sessionQueryOptions, signOut } from "@/lib/auth";

export const Route = createFileRoute("/_layout/_authenticated/profile")({
  head: () => ({
    meta: [{ title: "Profile" }, { name: "description", content: "Your account and session." }],
  }),
  component: ProfilePage,
});

type NearProfile = {
  name?: string;
  description?: string;
  image?: { url?: string; ipfs_cid?: string };
};

function resolveAvatarUrl(profile: NearProfile | null | undefined): string | null {
  const img = profile?.image;
  if (!img) return null;
  if (img.url) return img.url;
  if (img.ipfs_cid) return `https://ipfs.io/ipfs/${img.ipfs_cid}`;
  return null;
}

function ProfilePage() {
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const user = session?.user;
  const nearAccountId = authClient.near.getAccountId();

  const profileQuery = useQuery({
    queryKey: ["me", "near-profile", nearAccountId ?? null],
    queryFn: async () => {
      const res = await authClient.near.getProfile();
      return (res?.data ?? null) as NearProfile | null;
    },
    enabled: !!nearAccountId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const profile = profileQuery.data;
  const displayName =
    profile?.name?.trim() ||
    user?.name?.trim() ||
    user?.email?.trim() ||
    nearAccountId ||
    "anonymous";
  const avatarUrl = resolveAvatarUrl(profile);

  const signOutMutation = useMutation({
    mutationFn: () => signOut(authClient),
    onSuccess: async () => {
      queryClient.setQueryData(sessionQueryKey, null);
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      navigate({ to: "/", replace: true });
    },
    onError: (err: Error) => toast.error(err.message || "sign out failed"),
  });

  if (!user) {
    return (
      <Card>
        <CardContent className="text-center font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
          loading profile...
        </CardContent>
      </Card>
    );
  }

  const fallbackInitial = (displayName[0] ?? "?").toUpperCase();

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          your · account
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          Profile
        </h1>
      </header>

      <Card variant="hi-vis">
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Avatar className="size-16 rounded-full shrink-0">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="bg-muted text-foreground text-2xl font-display">
              {fallbackInitial}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-1 min-w-0">
            <div className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight break-words">
              {displayName}
            </div>
            {profile?.description && (
              <p className="text-sm text-muted-foreground leading-relaxed break-words">
                {profile.description}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            session
          </div>
          <h2 className="font-display text-2xl sm:text-3xl uppercase tracking-tight font-extrabold leading-[0.95]">
            Account
          </h2>
        </div>
        <Card>
          <CardContent className="grid gap-4">
            <Field label="email">
              <div className="border-2 border-border bg-muted/10 p-3 font-mono text-xs break-all">
                {user.email || "—"}
              </div>
            </Field>
            <Field label="near account">
              <div className="border-2 border-border bg-muted/10 p-3 font-mono text-xs break-all">
                {nearAccountId || "not linked"}
              </div>
            </Field>
            <Field label="user id">
              <div className="border-2 border-border bg-muted/10 p-3 font-mono text-xs break-all">
                {user.id}
              </div>
            </Field>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            display
          </div>
          <h2 className="font-display text-2xl sm:text-3xl uppercase tracking-tight font-extrabold leading-[0.95]">
            Theme
          </h2>
        </div>
        <Card>
          <CardContent className="flex items-center gap-3">
            <ThemeToggle />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              toggle light · dark
            </span>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <Button
          onClick={() => signOutMutation.mutate()}
          disabled={signOutMutation.isPending}
          variant="outline"
          className="font-display uppercase tracking-wide"
        >
          {signOutMutation.isPending ? "signing out..." : "sign out →"}
        </Button>
      </section>
    </div>
  );
}
