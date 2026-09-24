import type { ReactNode } from "react";
import { Badge, Card, CardContent } from "@/components";

export function OrganizationRowCard({
  name,
  role,
  details,
  children,
}: {
  name: string;
  role: string | null;
  details?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 min-w-0">
          <div className="font-display text-xl uppercase tracking-tight font-extrabold leading-tight break-words">
            {name}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {role ?? "member"}
            </Badge>
            {details}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
