import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components";
import { type ApiClient, useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { platformAgentReadKey } from "@/lib/queries";

const tokenOf = (asset: string) => asset.replace(/^nep141:/, "");
const amountOf = (amount: string | null, asset: string | null) =>
  amount && asset ? formatTokenAmount(amount, tokenOf(asset)) : (amount ?? "?");
const when = (at: string | null) => (at ? new Date(at).toLocaleString() : "—");

function Stale({ query }: { query: UseQueryResult<unknown, Error> }) {
  if (!query.isError) return null;
  return (
    <p className="text-sm text-destructive">
      {query.error.message || "The MultiAgency platform didn't answer."}
      {query.data
        ? ` Showing what it said at ${new Date(query.dataUpdatedAt).toLocaleString()}.`
        : ""}
    </p>
  );
}

function Section({
  title,
  children,
  onOpen,
}: {
  title: string;
  children: ReactNode;
  onOpen: () => void;
}) {
  return (
    <details
      className="border-t pt-3"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) onOpen();
      }}
    >
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function PlatformAgentPanel() {
  const apiClient = useApiClient();
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const open = (key: string) => () => setOpened((prev) => ({ ...prev, [key]: true }));
  const platform = apiClient.platformAgent;
  const read = <T,>(
    name: keyof ApiClient["platformAgent"],
    queryFn: () => Promise<T>,
    enabled = true,
  ) => ({
    queryKey: platformAgentReadKey(name),
    queryFn,
    enabled,
    retry: false,
    staleTime: 30_000,
  });

  const overview = useQuery(read("overview", () => platform.overview({})));
  const unresolved = useQuery(read("unresolved", () => platform.unresolved({})));
  const held = useQuery(read("held", () => platform.held({})));
  const activity = useQuery(read("activity", () => platform.activity({}), !!opened.activity));
  const ledger = useQuery(read("ledger", () => platform.ledger({}), !!opened.ledger));
  const policyHistory = useQuery(
    read("policyHistory", () => platform.policyHistory({}), !!opened.policyHistory),
  );
  const ownerActions = useQuery(
    read("ownerActions", () => platform.ownerActions({}), !!opened.ownerActions),
  );

  const o = overview.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3>Platform agent</h3>
        </CardTitle>
        <CardDescription>
          What the MultiAgency platform reports for this Organization's agent. Read only.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {unresolved.data && unresolved.data.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Unresolved sends</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>
                These block the agent's payouts until the platform proves their outcome. Don't pay
                them another way meanwhile.
              </span>
              <ul className="list-disc pl-5">
                {unresolved.data.map((u) => (
                  <li key={u.key}>
                    {u.kind} · {when(u.at)} · {u.status ?? "no status"}
                    {u.sent ? " · sent" : ""}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <Stale query={unresolved} />

        <Stale query={overview} />
        {o && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap gap-2">
              {o.frozen && <Badge variant="destructive">Frozen</Badge>}
              {o.notInForce && (
                <Badge variant="destructive">Rules not in force: {o.notInForce}</Badge>
              )}
              <Badge variant="outline">
                Rules revision {o.revision ?? "—"} · {o.status.toLowerCase()}
                {o.synced ? "" : " · not synced"}
              </Badge>
              {o.monthly && (
                <Badge variant="outline">
                  ${o.monthly.spentUsd} of ${o.monthly.limitUsd ?? "no limit"} this month
                  {o.monthly.resetsAt &&
                    ` · resets ${new Date(o.monthly.resetsAt).toLocaleDateString()}`}
                </Badge>
              )}
            </div>
            <p>
              Holds:{" "}
              {o.book.length
                ? o.book
                    .map(
                      (h) =>
                        `${formatTokenAmount(
                          (BigInt(h.public) + BigInt(h.confidential)).toString(),
                          tokenOf(h.asset),
                        )}${h.usd !== null ? ` (~$${h.usd.toFixed(2)})` : ""}`,
                    )
                    .join(", ")
                : "nothing"}
            </p>
            <p>
              Owner approval:{" "}
              {o.ownerApproval === null
                ? "unknown"
                : o.ownerApproval
                  ? "on. Each payout waits for the owner's vote."
                  : "off. Payouts to agreed payees within the caps go without another signature."}
            </p>
            <p>Agreed payees: {o.agreed.length ? o.agreed.join(", ") : "none yet"}.</p>
            {Object.keys(o.perTransaction).length > 0 && (
              <p>
                Per payout at most:{" "}
                {Object.entries(o.perTransaction)
                  .map(([asset, cap]) => formatTokenAmount(cap, tokenOf(asset)))
                  .join(", ")}
                .
              </p>
            )}
            <p>
              Grants:{" "}
              {o.grants.filter((g) => !g.revokedAt).length
                ? o.grants
                    .filter((g) => !g.revokedAt)
                    .map((g) => `${g.label} until ${new Date(g.expiresAt).toLocaleDateString()}`)
                    .join(", ")
                : "none"}
              .
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-3">
          <span className="text-sm font-medium">Held for the owner's vote</span>
          <Stale query={held} />
          {held.data &&
            (held.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is held.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {held.data.map((h) => (
                  <li key={h.correlationId}>
                    {amountOf(h.amount, h.asset)} to {h.recipient ?? "?"}
                    {h.chain ? ` (public withdrawal on ${h.chain})` : ""} · {when(h.at)}
                  </li>
                ))}
              </ul>
            ))}
        </div>

        <Section title="Activity" onOpen={open("activity")}>
          <Stale query={activity} />
          <Rows
            rows={activity.data?.map((a) => ({
              key: `${a.at}-${a.correlationId ?? a.kind}`,
              text: `${when(a.at)} · ${a.kind}${a.status ? ` · ${a.status}` : ""}${a.refused ? ` · refused: ${a.refused}` : ""}`,
            }))}
          />
        </Section>
        <Section title="Ledger" onOpen={open("ledger")}>
          <Stale query={ledger} />
          <Rows
            rows={ledger.data?.map((l) => ({
              key: l.correlationId,
              text: `${when(l.settledAt)} · ${l.type} · ${amountOf(l.amount, l.asset)}${l.recipient ? ` to ${l.recipient}` : ""} · ${l.status}${l.failureCode ? ` (${l.failureCode})` : ""}`,
            }))}
          />
        </Section>
        <Section title="Rules history" onOpen={open("policyHistory")}>
          <Stale query={policyHistory} />
          <Rows
            rows={policyHistory.data?.map((p) => ({
              key: `${p.revision}-${p.status}-${p.appliedAt}`,
              text: `Revision ${p.revision ?? "—"} · ${p.status.toLowerCase()} · ${when(p.appliedAt)}`,
            }))}
          />
        </Section>
        <Section title="Owner actions" onOpen={open("ownerActions")}>
          <Stale query={ownerActions} />
          <Rows
            rows={ownerActions.data?.map((a) => ({
              key: a.correlationId,
              text: `${a.type} · ${a.stage}${a.status ? ` · ${a.status}` : ""}${a.failureCode ? ` (${a.failureCode})` : ""} · until ${when(a.expiresAt)}`,
            }))}
          />
        </Section>
      </CardContent>
    </Card>
  );
}

function Rows({ rows }: { rows: Array<{ key: string; text: string }> | undefined }) {
  if (!rows) return null;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {rows.map((r) => (
        <li key={r.key}>{r.text}</li>
      ))}
    </ul>
  );
}
