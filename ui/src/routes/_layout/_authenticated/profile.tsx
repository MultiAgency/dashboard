import { MonitorIcon, MoonIcon, SignOutIcon, SunIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import { LoadingCard } from "@/components/loading-card";
import { MyOrganizations } from "@/components/my-organizations";
import { PageHeader } from "@/components/page-header";
import { PendingInvitationsList } from "@/components/pending-invitations";
import { SignInMethods } from "@/components/sign-in-methods";
import { sessionQueryKey, sessionQueryOptions } from "@/lib/auth";
import { realEmail } from "@/lib/membership";
import { type NearProfile, nearProfileQueryOptions } from "@/lib/near-profile";

export const Route = createFileRoute("/_layout/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile" },
      { name: "description", content: "Your account, sign-in methods and invitations." },
    ],
  }),
  component: ProfilePage,
});

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

  const profileQuery = useQuery(nearProfileQueryOptions(authClient, nearAccountId));

  const profile = profileQuery.data;
  const email = realEmail(user?.email);
  const displayName =
    profile?.name?.trim() || user?.name?.trim() || email || nearAccountId || "Anonymous";
  const avatarUrl = resolveAvatarUrl(profile);

  const signOutMutation = useMutation({
    mutationFn: () => authClient.signOut(),
    onSuccess: async () => {
      queryClient.setQueryData(sessionQueryKey, null);
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      navigate({ to: "/", replace: true });
    },
    onError: (err: Error) => toast.error(err.message || "Sign out failed"),
  });

  if (!user) {
    return (
      <ProfileLayout>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <LoadingCard label="profile" rows={3} />
      </ProfileLayout>
    );
  }

  const fallbackInitial = (displayName[0] ?? "?").toUpperCase();
  const subtitle = profile?.description?.trim() || email || nearAccountId;

  return (
    <ProfileLayout>
      <PageHeader
        title="Profile"
        description="Your account, how you sign in, and the Organizations you belong to."
        actions={
          <Button
            variant="outline"
            onClick={() => signOutMutation.mutate()}
            disabled={signOutMutation.isPending}
          >
            {signOutMutation.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SignOutIcon data-icon="inline-start" aria-hidden />
            )}
            Sign out
          </Button>
        }
      />

      <Card>
        <CardContent className="flex items-center gap-4">
          <Avatar className="size-12 shrink-0">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback>{fallbackInitial}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-heading text-base font-medium break-words">{displayName}</h2>
            {subtitle && (
              <p className="text-xs text-pretty break-words text-muted-foreground">{subtitle}</p>
            )}
            <p className="text-xs break-all text-muted-foreground">User ID: {user.id}</p>
          </div>
        </CardContent>
      </Card>

      <ProfileSection
        title="Sign-in methods"
        description="Ways you can sign in to this account. Add more so you never lose access."
      >
        <SignInMethods />
      </ProfileSection>

      <ProfileSection
        title="Organizations"
        description="Organizations you are a member of, and your role in each."
      >
        <MyOrganizations />
      </ProfileSection>

      <ProfileSection
        id="invitations"
        title="Invitations"
        description="Invitations to join an Organization, sent to your email."
      >
        <PendingInvitationsList />
      </ProfileSection>

      <ProfileSection title="Theme" description="Choose how MultiAgency looks on this device.">
        <ThemeChoice />
      </ProfileSection>
    </ProfileLayout>
  );
}

function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl animate-fade-in flex-col gap-6">{children}</div>
  );
}

function ProfileSection({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      value={mounted ? (theme ?? "system") : undefined}
      onValueChange={(value) => {
        if (value) setTheme(value);
      }}
      aria-label="Theme"
    >
      <ToggleGroupItem value="light">
        <SunIcon aria-hidden />
        Light
      </ToggleGroupItem>
      <ToggleGroupItem value="dark">
        <MoonIcon aria-hidden />
        Dark
      </ToggleGroupItem>
      <ToggleGroupItem value="system">
        <MonitorIcon aria-hidden />
        System
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
