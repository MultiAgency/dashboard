import type { ReactNode } from "react";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthCardHeader({
  icon,
  title,
  description,
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
}) {
  return (
    <CardHeader className="justify-items-center text-center">
      {icon && (
        <div className="mb-2 flex size-10 items-center justify-center bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <CardTitle className="break-words">
        <h1>{title}</h1>
      </CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}
