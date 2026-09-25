import { Card, CardContent } from "@/components";

export function LoadingCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
        loading {label}...
      </CardContent>
    </Card>
  );
}
