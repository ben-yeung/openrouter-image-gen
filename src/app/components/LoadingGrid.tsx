export function LoadingGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-xl bg-neutral-800" />
      ))}
    </div>
  );
}
