import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components";
import { formatTokenAmount } from "@/lib/format-amount";
import { ReportMarkdown } from "./report-markdown";

export type DeliveredWork = {
  workOrderCode: string;
  workOrderTitle: string;
  projectTitle: string;
  projectSlug: string;
  builderName: string;
  requestCode: string;
  coversFrom: string;
  coversTo: string;
  status: "approved" | "proposed" | "paid";
  contributionsMd: string;
  amount: { tokenId: string; amount: string } | null;
};

const STATUS_LABEL: Record<DeliveredWork["status"], string> = {
  approved: "Approved",
  proposed: "Being paid",
  paid: "Paid",
};

function DeliveredItem({ item }: { item: DeliveredWork }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.projectTitle}</span>
        <span className="text-sm text-muted-foreground">
          {item.builderName} · {item.coversFrom} → {item.coversTo}
        </span>
        <Badge variant={item.status === "paid" ? "outline" : "secondary"}>
          {STATUS_LABEL[item.status]}
        </Badge>
        {item.amount && (
          <span className="ml-auto text-sm tabular-nums">
            {formatTokenAmount(item.amount.amount, item.amount.tokenId)}
          </span>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {item.requestCode} under work order {item.workOrderCode}: {item.workOrderTitle}
      </span>
      <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide the work" : "Show the work"}
      </Button>
      {open && (
        <div className="border-t pt-3">
          <ReportMarkdown markdown={item.contributionsMd} />
        </div>
      )}
    </li>
  );
}

export function DeliveredWorkSection({ items }: { items: DeliveredWork[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Delivered work</h2>
        </CardTitle>
        <CardDescription>
          Work accepted for this period: the GitHub issues each builder was assigned, the pull
          requests the repository owner approved or merged, and their reviews.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <DeliveredItem key={item.requestCode} item={item} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
