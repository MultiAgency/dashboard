import { BuildingsIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function roleLabel(role: string | null | undefined): string {
  const value = role ?? "member";
  return ROLE_LABELS[value] ?? value;
}

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
    <Item asChild variant="outline" size="sm">
      <li>
        <ItemMedia variant="icon">
          <BuildingsIcon aria-hidden className="text-muted-foreground" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="break-words">{name}</ItemTitle>
          <ItemDescription>
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{roleLabel(role)}</Badge>
              {details}
            </span>
          </ItemDescription>
        </ItemContent>
        <ItemActions>{children}</ItemActions>
      </li>
    </Item>
  );
}
