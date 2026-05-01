import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Navigate,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UnderConstruction } from "@/components/under-construction";
import { organizationsQueryOptions, sessionQueryOptions } from "@/lib/session";

type SearchParams = {
  redirect?: string;
};

type AuthMethod = "near" | "email" | "phone" | "passkey" | "anonymous" | "github";

export const Route = createFileRoute("/_layout/login")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    const { queryClient } = context;
    const initialSession = context.session;
    const session =
      initialSession ?? queryClient.getQueryData(sessionQueryOptions(initialSession).queryKey);

    if (session?.user) {
      const redirectTo = search.redirect?.startsWith("/") ? search.redirect : "/home";
      throw redirect({ to: redirectTo, search: {} });
    }
  },
  loader: ({ context }) => {
    const initialSession = context.session;

    void context.queryClient.prefetchQuery(sessionQueryOptions(initialSession));
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { redirect } = Route.useSearch();
  const { data: session } = useQuery(sessionQueryOptions());
  const [authMethod, setAuthMethod] = useState<AuthMethod>("anonymous");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);

  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const handleSuccess = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: sessionQueryOptions().queryKey });
    await queryClient.invalidateQueries({ queryKey: organizationsQueryOptions().queryKey });
    router.invalidate();
    const redirectTo = redirect?.startsWith("/") ? redirect : "/home";
    navigate({ to: redirectTo, replace: true, search: {} });
    toast.success(message);
  };

  const nearMutation = useMutation({
    mutationFn: async () => {
      return new Promise<void>((resolve, reject) => {
        authClient.signIn.near({
          onSuccess: () => resolve(),
          onError: (error) => reject(error),
        });
      });
    },
    onSuccess: () => handleSuccess("Signed in with NEAR"),
    onError: (error: { code?: string; message?: string }) => {
      if (error.code === "UNAUTHORIZED_NONCE_REPLAY") {
        toast.error("Sign-in already used");
      } else if (error.code === "UNAUTHORIZED_INVALID_SIGNATURE") {
        toast.error("Invalid signature");
      } else if (error.code === "SIGNER_NOT_AVAILABLE") {
        toast.error("NEAR wallet not available");
      } else {
        toast.error(error.message || "Failed to sign in");
      }
    },
  });

  const passkeyMutation = useMutation({
    mutationFn: async () => {
      return new Promise<void>((resolve, reject) => {
        authClient.signIn.passkey({
          autoFill: false,
          fetchOptions: {
            onSuccess: () => resolve(),
            onError: (ctx) => reject(new Error(ctx.error?.message || "Passkey sign in failed")),
          },
        });
      });
    },
    onSuccess: () => handleSuccess("Signed in with passkey"),
    onError: (error: Error) => toast.error(error.message),
  });

  const anonymousMutation = useMutation({
    mutationFn: async () => {
      return new Promise<void>((resolve, reject) => {
        authClient.signIn.anonymous({
          fetchOptions: {
            onSuccess: () => resolve(),
            onError: (ctx) => reject(new Error(ctx.error?.message || "Anonymous sign in failed")),
          },
        });
      });
    },
    onSuccess: () => handleSuccess("Started anonymous session"),
    onError: (error: Error) => toast.error(error.message),
  });

  const emailSignInMutation = useMutation({
    mutationFn: async () => {
      return new Promise<void>((resolve, reject) => {
        authClient.signIn.email({
          email,
          password,
          fetchOptions: {
            onSuccess: () => resolve(),
            onError: (ctx: { error?: { message?: string } }) =>
              reject(new Error(ctx.error?.message || "Sign in failed")),
          },
        });
      });
    },
    onSuccess: () => handleSuccess("Signed in successfully"),
    onError: (error: Error) => toast.error(error.message),
  });

  const emailSignUpMutation = useMutation({
    mutationFn: async () => {
      return new Promise<void>((resolve, reject) => {
        authClient.signUp.email({
          email,
          password,
          name: email.split("@")[0],
          fetchOptions: {
            onSuccess: () => resolve(),
            onError: (ctx) => reject(new Error(ctx.error?.message || "Sign up failed")),
          },
        });
      });
    },
    onSuccess: () => handleSuccess("Account created! Check your email to verify."),
    onError: (error: Error) => toast.error(error.message),
  });

  const sendOtpMutation = useMutation({
    mutationFn: async () => {
      return new Promise<void>((resolve, reject) => {
        authClient.phoneNumber.sendOtp({
          phoneNumber,
          fetchOptions: {
            onSuccess: () => resolve(),
            onError: (ctx) => reject(new Error(ctx.error?.message || "Failed to send code")),
          },
        });
      });
    },
    onSuccess: () => {
      setOtpSent(true);
      toast.success("Verification code sent!");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async () => {
      return new Promise<void>((resolve, reject) => {
        authClient.phoneNumber.verify({
          phoneNumber,
          code: otpCode,
          fetchOptions: {
            onSuccess: () => resolve(),
            onError: (ctx: { error?: { message?: string } }) =>
              reject(new Error(ctx.error?.message || "Invalid code")),
          },
        });
      });
    },
    onSuccess: () => handleSuccess("Signed in with phone"),
    onError: (error: Error) => toast.error(error.message),
  });

  const githubMutation = useMutation({
    mutationFn: async () => {
      return new Promise<void>((resolve, reject) => {
        authClient.signIn.social({
          provider: "github",
          callbackURL: redirect?.startsWith("/") ? redirect : "/home",
          fetchOptions: {
            onSuccess: () => resolve(),
            onError: (ctx) => reject(new Error(ctx.error?.message || "GitHub sign in failed")),
          },
        });
      });
    },
    onSuccess: () => handleSuccess("Signed in with GitHub"),
    onError: (error: Error) => toast.error(error.message),
  });

  const handleEmailSubmit = () => {
    if (!email || !password) {
      toast.error("Please enter email and password");
      return;
    }
    if (isSignUp && password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (isSignUp) {
      emailSignUpMutation.mutate();
    } else {
      emailSignInMutation.mutate();
    }
  };

  const handleSendOtp = () => {
    if (!phoneNumber || phoneNumber.length < 10) {
      toast.error("Please enter a valid phone number");
      return;
    }
    sendOtpMutation.mutate();
  };

  const handleVerifyOtp = () => {
    if (!otpCode || otpCode.length < 4) {
      toast.error("Please enter the verification code");
      return;
    }
    verifyOtpMutation.mutate();
  };

  const isPending =
    nearMutation.isPending ||
    passkeyMutation.isPending ||
    anonymousMutation.isPending ||
    emailSignInMutation.isPending ||
    emailSignUpMutation.isPending ||
    sendOtpMutation.isPending ||
    verifyOtpMutation.isPending ||
    githubMutation.isPending;

  if (session?.user) {
    const redirectTo = redirect?.startsWith("/") ? redirect : "/home";
    return <Navigate to={redirectTo} replace search={{}} />;
  }

  const renderAuthMethod = () => {
    switch (authMethod) {
      case "near":
        return (
          <div className="space-y-6">
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              Connect your NEAR wallet for on-chain identity
            </p>
            <Button onClick={() => nearMutation.mutate()} disabled={isPending} className="w-full">
              {nearMutation.isPending ? "connecting..." : "connect NEAR wallet"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Recommended for blockchain features
            </p>
          </div>
        );

      case "passkey":
        return (
          <div className="space-y-6">
            <UnderConstruction
              label="Passkey"
              sourceFile="ui/src/routes/_layout/login.tsx"
              className="mx-auto w-full max-w-xs"
            />
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              Use Face ID, Touch ID, or security key
            </p>
            <Button
              onClick={() => passkeyMutation.mutate()}
              disabled={isPending}
              className="w-full"
            >
              {passkeyMutation.isPending ? "authenticating..." : "sign in with passkey"}
            </Button>
          </div>
        );

      case "anonymous":
        return (
          <div className="space-y-6">
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              Start without creating an account or saving persistent data
            </p>
            <Button
              onClick={() => anonymousMutation.mutate()}
              disabled={isPending}
              className="w-full"
            >
              {anonymousMutation.isPending ? "starting..." : "continue anonymously"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Your session will not persist after you sign out
            </p>
          </div>
        );

      case "email":
        return (
          <div className="space-y-6">
            <UnderConstruction
              label="Email"
              sourceFile="ui/src/routes/_layout/login.tsx"
              className="mx-auto w-full max-w-xs"
            />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
            />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
            />
            <Button onClick={handleEmailSubmit} disabled={isPending} className="w-full">
              {emailSignInMutation.isPending || emailSignUpMutation.isPending
                ? isSignUp
                  ? "creating..."
                  : "signing in..."
                : isSignUp
                  ? "create account"
                  : "sign in"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setIsSignUp(!isSignUp)}
              disabled={isPending}
              className="w-full"
            >
              {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
            </Button>
          </div>
        );

      case "phone":
        return (
          <div className="space-y-6">
            <UnderConstruction
              label="Phone"
              sourceFile="ui/src/routes/_layout/login.tsx"
              className="mx-auto w-full max-w-xs"
            />
            {!otpSent ? (
              <>
                <Input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                />
                <Button onClick={handleSendOtp} disabled={isPending} className="w-full">
                  {sendOtpMutation.isPending ? "sending..." : "send code"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Enter your phone number to receive a verification code
                </p>
              </>
            ) : (
              <>
                <Input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="text-center tracking-widest"
                />
                <Button onClick={handleVerifyOtp} disabled={isPending} className="w-full">
                  {verifyOtpMutation.isPending ? "verifying..." : "verify & sign in"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                  }}
                  disabled={isPending}
                  className="w-full"
                >
                  Use different phone number
                </Button>
              </>
            )}
          </div>
        );

      case "github":
        return (
          <div className="space-y-6">
            <UnderConstruction
              label="GitHub"
              sourceFile="ui/src/routes/_layout/login.tsx"
              className="mx-auto w-full max-w-xs"
            />
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              Sign in with your GitHub account
            </p>
            <Button onClick={() => githubMutation.mutate()} disabled={isPending} className="w-full">
              {githubMutation.isPending ? "redirecting..." : "sign in with GitHub"}
            </Button>
          </div>
        );
    }
  };

  return (
    <div className="min-h-[70vh] w-full flex items-start justify-center px-6 pt-[15vh] animate-fade-in">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-wrap justify-center gap-2">
          {(["anonymous", "near", "github", "passkey", "email", "phone"] as AuthMethod[]).map(
            (method) => (
              <Button
                key={method}
                variant={authMethod === method ? "default" : "outline"}
                size="sm"
                onClick={() => setAuthMethod(method)}
                disabled={isPending}
              >
                {method}
              </Button>
            ),
          )}
        </div>

        <div className="animate-fade-in-up" key={authMethod}>
          {renderAuthMethod()}
        </div>

        {authMethod !== "near" && (
          <div className="pt-6 border-t border-border">
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              You can link a NEAR wallet later for on-chain features
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
