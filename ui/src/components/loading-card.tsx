import { Card, CardContent, CardDescription } from "@/components";

export function LoadingCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent>
        <CardDescription>loading {label}...</CardDescription>
      </CardContent>
    </Card>
  );
}
