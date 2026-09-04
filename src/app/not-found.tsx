import { OraWordmark } from "@/components/brand/wordmark";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-6">
      <div className="max-w-sm text-center">
        <OraWordmark className="mx-auto mb-8 justify-center text-lg text-ink" />
        <h1 className="font-sans text-2xl font-semibold tracking-tight text-ink">
          Page not found
        </h1>
        <p className="mt-2 font-serif text-[15px] text-muted">
          The page — or payment — you&rsquo;re looking for doesn&rsquo;t exist, or the link has expired.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <LinkButton href="/" variant="secondary">
            Go home
          </LinkButton>
          <LinkButton href="/demo">Try the live checkout</LinkButton>
        </div>
      </div>
    </div>
  );
}
