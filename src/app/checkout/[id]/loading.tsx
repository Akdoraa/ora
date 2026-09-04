export default function CheckoutLoading() {
  return (
    <div className="ora-checkout-bg min-h-dvh px-4 py-8 sm:px-6 sm:py-14">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
        <div className="animate-pulse rounded-[var(--radius-card)] border border-line bg-card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="h-4 w-28 rounded bg-[#eeece6]" />
            <div className="h-4 w-12 rounded bg-[#eeece6]" />
          </div>
          <div className="my-4 h-px bg-line" />
          <div className="h-5 w-4/5 rounded bg-[#eeece6]" />
          <div className="mt-2 h-3 w-24 rounded bg-[#eeece6]" />
          <div className="mt-6 space-y-3">
            <div className="h-3 w-full rounded bg-[#eeece6]" />
            <div className="h-3 w-full rounded bg-[#eeece6]" />
            <div className="h-3 w-3/4 rounded bg-[#eeece6]" />
          </div>
          <div className="mt-6 h-16 rounded-xl bg-[#eeece6]" />
          <div className="mt-6 h-11 rounded-full bg-[#eeece6]" />
        </div>
        <div className="hidden animate-pulse rounded-[var(--radius-card)] border border-line bg-card p-5 lg:block">
          <div className="h-4 w-32 rounded bg-[#eeece6]" />
          <div className="mt-3 h-3 w-full rounded bg-[#eeece6]" />
          <div className="mt-2 h-3 w-5/6 rounded bg-[#eeece6]" />
        </div>
      </div>
    </div>
  );
}
