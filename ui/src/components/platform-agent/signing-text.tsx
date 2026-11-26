import { platformTextFields } from "@/lib/platform-agent-signing";

const SCOPES: Record<string, string> = {
  payout:
    "Ask the agent to pay agreed builders for approved compensation, within the rules you signed. Each payout is sent at most once.",
  read: "Read the agent: balance, signed rules, activity, ledger, held and unresolved payouts.",
  owner:
    "Prepare owner actions. Each one still needs your wallet's signature, or the confirm page.",
};

const FIELD_LABELS: Array<[string, string]> = [
  ["type", "What"],
  ["host", "Platform"],
  ["deployment", "App"],
  ["organization", "Organization"],
  ["owner", "Owner"],
  ["area", "Area"],
  ["agent", "Agent"],
  ["agentId", "Agent ID"],
  ["expiresAt", "Until"],
];

export function SigningText({
  message,
  recipient,
  expiresAt,
  host,
}: {
  message: string;
  recipient: string;
  expiresAt: string;
  host: string;
}) {
  const fields = platformTextFields(message);
  const scopes = Array.isArray(fields?.scopes) ? fields.scopes.map(String) : [];
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm">
        Your wallet will be asked to sign exactly this text, for{" "}
        <span className="font-mono">{recipient}</span>. Check that your wallet shows the same text
        and recipient before you approve.
      </p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">
        {message}
      </pre>
      {fields && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {FIELD_LABELS.filter(([key]) => fields[key] !== undefined).map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all font-mono text-xs leading-5">{String(fields[key])}</dd>
            </div>
          ))}
        </dl>
      )}
      {scopes.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {scopes.map((scope) => (
            <li key={scope}>
              <span className="font-mono">{scope}</span>: {SCOPES[scope] ?? "Not described here."}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Sign before {new Date(expiresAt).toLocaleTimeString()}. The dashboard never asks you to sign
        "Sign in to {host}".
      </p>
    </div>
  );
}
