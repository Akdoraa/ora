import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, Hairline, Badge, Row } from "@/components/ui/primitives";
import { CopyBlock } from "@/components/dashboard/copy-block";
import { WebhookRow } from "@/components/dashboard/webhook-row";
import { WebhookEndpoints } from "@/components/dashboard/webhook-endpoints";
import { merchantWebhookLog } from "@/lib/analytics/merchant";
import { currentMerchantId, DEMO_API_KEY } from "@/lib/dashboard";
import { seedId } from "@/lib/ids";
import { env } from "@/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Developers" };

const SNIPPET = `import { Ora } from "@ora/node"; // illustrative SDK shape

const ora = new Ora(process.env.ORA_API_KEY!);

// Create a payment intent and redirect the customer (or hand the
// manifest URL to an autonomous agent).
const payment = await ora.paymentIntents.create({
  amount: 100_000,            // minor units
  currency: "GBP",
  settlementCurrency: "SGD",
  description: "Annual software plan",
  reference: "INV-2091",
  successUrl: "https://acme.example/thanks",
  webhookUrl: "https://acme.example/webhooks/ora",
});

redirect(payment.checkoutUrl);
// agents instead read: payment.manifestUrl  (machine-readable offer + x402)`;

const CURL = (base: string, key: string) =>
  `curl -sX POST ${base}/api/payment-intents \\
  -H "authorization: Bearer ${key}" \\
  -H "content-type: application/json" \\
  -H "idempotency-key: $(uuidgen)" \\
  -d '{"amount":100000,"currency":"GBP","settlementCurrency":"SGD",
       "description":"Annual software plan","webhookUrl":"${base}/api/webhooks/test"}'`;

const X402_EXAMPLE = `// An x402-protected service Ora's agent can pay:
// 1. GET/POST the resource -> HTTP 402 + PAYMENT-REQUIRED header
// 2. agent presigns an XRPL Payment for the quoted amount to payTo
// 3. retry with PAYMENT-SIGNATURE -> 200 + PAYMENT-RESPONSE (tx hash)
POST ${"${ORA_URL}"}/api/x402/quote
  { paymentIntentId, amountInMinor, amountInCurrency,
    amountOutCurrency, midRate, fxSpreadBps, processingFeeBps }
-> 402  PAYMENT-REQUIRED: <base64 { accepts:[{ scheme:"exact",
        network:"xrpl:1", asset:"XRP", payTo, amount, extra:{invoiceId} }] }>
-> 200  { quote:{ effectiveRate, amountOutMinor, validUntil }, signature }`;

export default async function DevelopersPage() {
  const { endpoints, deliveries } = await merchantWebhookLog(currentMerchantId());
  const productId = seedId("prod", "sea-report");
  const base = env.APP_URL;
  const masked = `${DEMO_API_KEY.slice(0, 18)}${"•".repeat(8)}${DEMO_API_KEY.slice(-4)}`;

  return (
    <DashboardShell
      active="/dashboard/developers"
      title="Developers"
      action={<Badge tone="warning" className="font-mono lowercase tracking-normal">sandbox · testnet</Badge>}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="text-[12px] font-medium text-faint">API keys</div>
          <div className="mt-3 rounded-lg border border-line bg-paper px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[13px] text-ink">{masked}</span>
              <Badge tone="neutral">test</Badge>
            </div>
            <div className="mt-1 font-mono text-[11px] text-faint">
              Demo key — full value: <span className="select-all text-ink-soft">{DEMO_API_KEY}</span>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Send as <code className="font-mono">Authorization: Bearer …</code>. Keys are stored
            hashed (SHA-256); the plaintext is shown once on creation.
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium text-faint">
            Hosted checkout & manifest
          </div>
          <Row
            label="Checkout URL"
            value={<span className="font-mono text-[12px]">{base}/checkout/&#123;id&#125;</span>}
          />
          <Row
            label="Agent manifest"
            value={<span className="font-mono text-[12px]">{base}/api/payment-intents/&#123;id&#125;/manifest</span>}
          />
          <Row
            label="x402 oracle"
            value={<span className="font-mono text-[12px]">{base}/api/x402/quote</span>}
          />
          <Hairline className="my-3" />
          <div className="text-[12px] text-muted">
            Seeded product id: <code className="font-mono select-all">{productId}</code>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="px-5 py-3 text-[12px] font-medium text-faint">
            TypeScript integration
          </div>
          <Hairline />
          <CopyBlock code={SNIPPET} lang="ts" />
        </Card>
        <Card className="overflow-hidden">
          <div className="px-5 py-3 text-[12px] font-medium text-faint">
            Create a payment intent (curl)
          </div>
          <Hairline />
          <CopyBlock code={CURL(base, DEMO_API_KEY)} lang="bash" />
        </Card>
      </div>

      <div className="mt-4">
        <WebhookEndpoints
          endpoints={endpoints.map((e) => ({
            id: e.id,
            url: e.url,
            active: e.active,
            enabledEvents: e.enabledEvents ?? [],
          }))}
        />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="px-5 py-3 text-[12px] font-medium text-faint">
          x402 service integration
        </div>
        <Hairline />
        <CopyBlock code={X402_EXAMPLE} lang="text" />
      </Card>

      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-[12px] font-medium text-faint">
            Webhook log
          </span>
          <span className="font-mono text-[11px] text-faint">
            {endpoints.map((e) => e.url).join(", ") || "no endpoints"}
          </span>
        </div>
        <Hairline />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <tbody>
              {deliveries.map((d) => (
                <WebhookRow
                  key={d.id}
                  d={{
                    id: d.id,
                    eventType: d.eventType,
                    signature: d.signature,
                    status: d.status,
                    responseStatus: d.responseStatus,
                    attempts: d.attempts,
                    createdAt: d.createdAt.toISOString(),
                  }}
                />
              ))}
              {deliveries.length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-sm text-muted" colSpan={6}>
                    No deliveries yet.{" "}
                    <Link href="/demo" className="text-brand hover:underline">
                      Run the demo →
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-[11px] text-faint">
        Signature header: <code className="font-mono">Ora-Signature: t=&lt;unix&gt;,v1=&lt;hmac-sha256(t.body)&gt;</code>.
        Full API reference in <code className="font-mono">docs/API.md</code>.
      </p>
    </DashboardShell>
  );
}
