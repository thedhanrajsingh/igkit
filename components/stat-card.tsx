export default function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel rounded p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
    </div>
  );
}
