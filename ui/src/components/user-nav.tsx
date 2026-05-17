import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sessionQueryKey, sessionQueryOptions } from "@/lib/auth";
import { meRolesQueryKey } from "@/lib/queries";

export function UserNav() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const authClient = useAuthClient();

  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const user = session?.user;

  const connectMutation = useMutation({
    mutationFn: () => authClient.signIn.near(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionQueryOptions(authClient).queryKey }),
        queryClient.invalidateQueries({ queryKey: meRolesQueryKey }),
      ]);
      navigate({ to: "/treasury" });
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Failed to connect NEAR wallet");
    },
  });

  const signOutMutation = useMutation({
    mutationFn: () => authClient.signOut(),
    onSuccess: async () => {
      queryClient.setQueryData(sessionQueryKey, null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
        queryClient.invalidateQueries({ queryKey: meRolesQueryKey }),
      ]);
      navigate({ to: "/", replace: true });
    },
    onError: (error: Error) => {
      console.error("Sign out error:", error);
    },
  });

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => connectMutation.mutate()}
          disabled={connectMutation.isPending}
        >
          {connectMutation.isPending ? "connecting..." : "connect"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="cursor-pointer rounded-sm hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            title="menu"
          >
            <Avatar className="size-8 rounded-full">
              {user.image && (
                <AvatarImage src={user.image} alt={user.name || user.email || user.id} />
              )}
              <AvatarFallback className="bg-muted text-foreground border-0 text-xs font-medium">
                {(user.name || user.email || user.id).charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link to="/profile" className="font-mono text-xs uppercase tracking-wide">
              profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              signOutMutation.mutate();
            }}
            disabled={signOutMutation.isPending}
            className="font-mono text-xs uppercase tracking-wide"
          >
            {signOutMutation.isPending ? "signing out..." : "sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
