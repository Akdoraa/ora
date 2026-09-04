export default function DashboardLoading() {
  return (
    <div className="min-h-dvh bg-paper">
      <div className="border-b border-line bg-card">
        <div className="mx-auto h-[52px] max-w-6xl px-6" />
      </div>
      <div className="mx-auto max-w-6xl animate-pulse px-6 py-8">
        <div className="mb-6 h-7 w-40 rounded bg-[#eeece6]" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-[var(--radius-card)] border border-line bg-card p-4">
              <div className="h-3 w-20 rounded bg-[#eeece6]" />
              <div className="mt-3 h-6 w-16 rounded bg-[#eeece6]" />
            </div>
          ))}
        </div>
        <div className="mt-3 h-64 rounded-[var(--radius-card)] border border-line bg-card" />
      </div>
    </div>
  );
}
