import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { getAppName } from "@/app";
import { useClientValue } from "@/hooks/use-client";

type Tab = "server" | "prompt";

export const Route = createFileRoute("/_layout/_authenticated/_admin/dashboard")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("server");
  const appName = useClientValue(() => getAppName(), "app");
  const tabs: { key: Tab; label: string }[] = [
    { key: "server", label: "server" },
    { key: "prompt", label: "prompt" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-border/50">
        <div className="flex items-center gap-2 text-xs font-mono">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            {appName}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground">admin</span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          {tabs.map((t) => (
            <button
              type="button"
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`transition-colors ${
                tab === t.key ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "server" && <ServerSection />}
      {tab === "prompt" && <PromptSection />}
    </div>
  );
}

function ServerSection() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Server management coming soon.</p>
    </div>
  );
}

function PromptSection() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Prompt interface coming soon.</p>
    </div>
  );
}
