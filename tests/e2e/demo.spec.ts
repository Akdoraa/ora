import { test, expect } from "@playwright/test";

/**
 * The one required end-to-end test: landing → seeded checkout → agent route
 * selection → approval → real x402 payment → real XRPL settlement → fulfilment
 * → receipt → merchant dashboard update.
 *
 * This performs genuine XRPL Testnet transactions, so it is slow (~40s).
 */
test("full commercial loop", async ({ page }) => {
  test.setTimeout(180_000);

  // 1 — landing
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Processing fees, solved/i })).toBeVisible();

  // 2 — launch a fresh seeded checkout
  await page.goto("/demo?fresh=1");
  await expect(page).toHaveURL(/\/checkout\/pi_/);
  await expect(page.getByText("Pay by bank")).toBeVisible();
  await expect(page.getByText("£4,250.00")).toBeVisible();
  const checkoutUrl = page.url();
  const intentId = checkoutUrl.split("/checkout/")[1]!;

  // 3 — run the agent
  await page.getByRole("button", { name: /Authorize with Ora agent/i }).click();

  // 4 — routes compared: one selected, others rejected
  await expect(page.getByText("ROUTES CONSIDERED")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("SELECTED").first()).toBeVisible();
  await expect(page.getByText("REJECTED").first()).toBeVisible();

  // 5 — human approval gate (£4,250 > £4,000, new payee)
  await expect(page.getByText("Approval needed")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Approve £4,250/i }).click();

  // 6 — real x402 + XRPL settlement → receipt
  await expect(page).toHaveURL(new RegExp(`/checkout/${intentId}/receipt`), {
    timeout: 120_000,
  });
  await expect(page.getByRole("heading", { name: "Payment complete" })).toBeVisible();
  await expect(page.getByText("Saved vs card")).toBeVisible();
  await expect(page.getByText("SGD 7,203.19", { exact: true }).first()).toBeVisible();

  // 7 — settlement details carry both real tx hashes
  await page.locator("summary", { hasText: "Settlement details" }).click();
  await expect(page.getByText("XRPL settlement")).toBeVisible();
  await expect(page.getByText("x402 quote payment")).toBeVisible();

  // 8 — verify a settlement hash via the public endpoint
  const explorerLink = page
    .locator('a[href*="/transactions/"]')
    .filter({ hasText: "✓" })
    .last();
  const href = await explorerLink.getAttribute("href");
  const hash = href!.split("/transactions/")[1]!;
  const verify = await page.request.get(`/api/xrpl/transactions/${hash}`);
  expect(verify.ok()).toBeTruthy();
  expect((await verify.json()).success).toBe(true);

  // 9 — merchant dashboard reflects the payment
  await page.goto("/dashboard");
  await expect(page.getByText("Saved vs card (4%)")).toBeVisible();
  await expect(page.getByText("Recent payments")).toBeVisible();

  await page.goto(`/dashboard/payments/${intentId}`);
  await expect(page.getByText("delivered").first()).toBeVisible();
  await expect(page.getByText("settlement.succeeded").first()).toBeVisible();
  await expect(page.getByText("Audit trail")).toBeVisible();
});
