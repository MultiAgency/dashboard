export function BuilderAvatar({
  name,
  nearAccount,
  className = "size-14",
}: {
  name: string | null;
  nearAccount: string;
  className?: string;
}) {
  const label = (name?.trim() || nearAccount).slice(0, 2).toUpperCase();
  return (
    <div
      className={`${className} rounded-full bg-muted border border-border flex items-center justify-center font-display text-lg font-black uppercase shrink-0`}
      aria-hidden
    >
      {label}
    </div>
  );
}
