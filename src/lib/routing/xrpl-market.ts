import Decimal from "decimal.js";
import { RLUSD_ISSUER, RLUSD_CURRENCY_HEX } from "@/lib/xrpl/assets";
import { withXrpl } from "@/lib/xrpl/client";
import { logger } from "@/lib/logger";

/**
 * Real, live XRPL market data — the XRP/RLUSD Automated Market Maker pool
 * and the native central limit order book, both queried straight off the
 * ledger (amm_info / book_offers). Nothing here is a made-up number: every
 * figure this module returns is read from an actual, currently-open XRPL
 * ledger object, for the actual amount this payment needs. If the ledger
 * can't answer (no pool, thin book, network hiccup), the caller gets `null`
 * back — never a fabricated fallback quote.
 */

const RLUSD_SPEC = { currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_ISSUER } as const;

// Minimal shape of what we actually call — lets tests pass a fake client
// with fixture responses instead of hitting the network.
export interface XrplRequestClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request(req: Record<string, unknown>): Promise<{ result: any }>;
}

export interface LiveXrplQuote {
  /** XRP (in drops) this venue needs, right now, to deliver the requested RLUSD */
  xrpDropsCost: string;
  /** the venue's own stated fee, in bps (AMM only — a CLOB has no separate fee, the spread IS the cost) */
  venueFeeBps: number;
  /** extra cost from walking real depth, beyond the venue's stated fee, in bps */
  slippageBps: number;
}

/**
 * XRPL AMM pool (amm_info): constant-product math (`x*y=k`), reversed to
 * solve "how much XRP in, to get exactly this much RLUSD out", using the
 * pool's own live reserves and live trading_fee (a real on-ledger field,
 * in units of 1/100,000 — see XLS-30).
 */
export async function ammQuoteForRlusdOut(
  client: XrplRequestClient,
  rlusdOut: string,
): Promise<LiveXrplQuote | null> {
  const res = await client.request({
    command: "amm_info",
    asset: { currency: "XRP" },
    asset2: RLUSD_SPEC,
  });
  const amm = res.result?.amm;
  if (!amm?.amount || !amm?.amount2) return null;

  const xReserve = new Decimal(amm.amount as string); // drops
  const yReserve = new Decimal((amm.amount2 as { value: string }).value); // RLUSD
  const feeBps = Number(amm.trading_fee ?? 0) / 10;
  const dy = new Decimal(rlusdOut);
  if (!dy.isFinite() || dy.lte(0) || dy.gte(yReserve)) return null; // would drain the pool

  const f = new Decimal(1).minus(new Decimal(feeBps).div(10_000));
  if (f.lte(0)) return null;
  // dy = y * dx*f / (x + dx*f)  =>  dx = dy*x / (f*(y-dy))
  const dxDrops = dy.times(xReserve).div(f.times(yReserve.minus(dy)));

  const spotRateRlusdPerXrp = yReserve.div(xReserve); // zero-fee, zero-slippage reference
  const idealDxDrops = dy.div(spotRateRlusdPerXrp);
  const totalBps = dxDrops.minus(idealDxDrops).div(idealDxDrops).times(10_000);

  return {
    xrpDropsCost: dxDrops.toFixed(0),
    venueFeeBps: feeBps,
    slippageBps: Math.max(0, totalBps.minus(feeBps).toNumber()),
  };
}

/**
 * XRPL native order book (book_offers): walks real, currently-funded offers
 * (respecting each offer's own `owner_funds` cap) to find the actual cost of
 * sourcing this much RLUSD right now — a genuine depth-of-book quote, not an
 * indicative top-of-book price.
 */
export async function orderBookQuoteForRlusdOut(
  client: XrplRequestClient,
  rlusdOut: string,
): Promise<LiveXrplQuote | null> {
  const res = await client.request({
    command: "book_offers",
    taker_gets: RLUSD_SPEC,
    taker_pays: { currency: "XRP" },
    limit: 40,
  });
  const offers = res.result?.offers as
    | Array<{ TakerGets: { value: string }; TakerPays: string; owner_funds?: string }>
    | undefined;
  if (!offers?.length) return null;

  let remaining = new Decimal(rlusdOut);
  let xrpDropsSpent = new Decimal(0);
  let bestRateSeen: Decimal | null = null; // RLUSD per XRP, best (first) offer in the book

  for (const o of offers) {
    if (remaining.lte(0)) break;
    const listed = new Decimal(o.TakerGets.value);
    const funded = o.owner_funds !== undefined ? new Decimal(o.owner_funds) : listed;
    const fillable = Decimal.min(listed, funded);
    if (fillable.lte(0)) continue;

    const xrpPerRlusd = new Decimal(o.TakerPays).div(1_000_000).div(listed);
    if (!bestRateSeen) bestRateSeen = new Decimal(1).div(xrpPerRlusd);

    const rlusdFromThis = Decimal.min(remaining, fillable);
    xrpDropsSpent = xrpDropsSpent.plus(rlusdFromThis.times(xrpPerRlusd).times(1_000_000));
    remaining = remaining.minus(rlusdFromThis);
  }

  if (remaining.gt(0) || !bestRateSeen) return null; // book too thin to fully fill this payment

  const idealDrops = new Decimal(rlusdOut).div(bestRateSeen).times(1_000_000);
  const slippageBps = xrpDropsSpent.minus(idealDrops).div(idealDrops).times(10_000);

  return {
    xrpDropsCost: xrpDropsSpent.toFixed(0),
    venueFeeBps: 0,
    slippageBps: Math.max(0, slippageBps.toNumber()),
  };
}

/** Live wrappers using the shared XRPL connection — swallow errors to `null`
 * (a network hiccup means "this route isn't offered this run", never a
 * fabricated one). */
export async function liveAmmQuoteForRlusdOut(rlusdOut: string): Promise<LiveXrplQuote | null> {
  try {
    return await withXrpl((client) => ammQuoteForRlusdOut(client, rlusdOut));
  } catch (err) {
    logger.warn({ err }, "xrpl amm_info unavailable — no live AMM route this run");
    return null;
  }
}

export async function liveOrderBookQuoteForRlusdOut(
  rlusdOut: string,
): Promise<LiveXrplQuote | null> {
  try {
    return await withXrpl((client) => orderBookQuoteForRlusdOut(client, rlusdOut));
  } catch (err) {
    logger.warn({ err }, "xrpl book_offers unavailable — no live order-book route this run");
    return null;
  }
}

/**
 * Combined execution: take whatever the real order book can genuinely fill
 * first (it's discrete, funded liquidity — always at least as good as the
 * AMM for the portion it covers), then source anything left over from the
 * live AMM. This isn't a third independent venue — it's what XRPL's own
 * payment engine actually does for a real cross-currency Payment (it always
 * sources from whichever combination of the order book and an AMM gives the
 * best real execution) — so it will often fill trades the order book alone
 * can't, and cost less than the AMM alone for however much of the trade the
 * book could genuinely cover.
 */
export async function combinedQuoteForRlusdOut(
  client: XrplRequestClient,
  rlusdOut: string,
): Promise<LiveXrplQuote | null> {
  const [bookRes, ammRes] = await Promise.all([
    client.request({
      command: "book_offers",
      taker_gets: RLUSD_SPEC,
      taker_pays: { currency: "XRP" },
      limit: 40,
    }),
    client.request({ command: "amm_info", asset: { currency: "XRP" }, asset2: RLUSD_SPEC }),
  ]);
  const offers = bookRes.result?.offers as
    | Array<{ TakerGets: { value: string }; TakerPays: string; owner_funds?: string }>
    | undefined;
  const amm = ammRes.result?.amm;

  let remaining = new Decimal(rlusdOut);
  let xrpDropsSpent = new Decimal(0);
  let bestBookRate: Decimal | null = null;

  for (const o of offers ?? []) {
    if (remaining.lte(0)) break;
    const listed = new Decimal(o.TakerGets.value);
    const funded = o.owner_funds !== undefined ? new Decimal(o.owner_funds) : listed;
    const fillable = Decimal.min(listed, funded);
    if (fillable.lte(0)) continue;
    const xrpPerRlusd = new Decimal(o.TakerPays).div(1_000_000).div(listed);
    if (!bestBookRate) bestBookRate = new Decimal(1).div(xrpPerRlusd);
    const take = Decimal.min(remaining, fillable);
    xrpDropsSpent = xrpDropsSpent.plus(take.times(xrpPerRlusd).times(1_000_000));
    remaining = remaining.minus(take);
  }

  let venueFeeBps = 0;
  if (remaining.gt(0) && amm?.amount && amm?.amount2) {
    const xReserve = new Decimal(amm.amount as string);
    const yReserve = new Decimal((amm.amount2 as { value: string }).value);
    const feeBps = Number(amm.trading_fee ?? 0) / 10;
    const f = new Decimal(1).minus(new Decimal(feeBps).div(10_000));
    if (remaining.lt(yReserve) && f.gt(0)) {
      xrpDropsSpent = xrpDropsSpent.plus(
        remaining.times(xReserve).div(f.times(yReserve.minus(remaining))),
      );
      venueFeeBps = feeBps;
      remaining = new Decimal(0);
    }
  }

  if (remaining.gt(0)) return null; // neither source, even combined, can fill this

  const ammSpotRate =
    amm?.amount && amm?.amount2
      ? new Decimal((amm.amount2 as { value: string }).value).div(amm.amount as string)
      : null;
  const referenceRate =
    bestBookRate && ammSpotRate
      ? Decimal.max(bestBookRate, ammSpotRate)
      : (bestBookRate ?? ammSpotRate);
  if (!referenceRate) return null;

  const idealDrops = new Decimal(rlusdOut).div(referenceRate).times(1_000_000);
  const totalBps = xrpDropsSpent.minus(idealDrops).div(idealDrops).times(10_000);

  return {
    xrpDropsCost: xrpDropsSpent.toFixed(0),
    venueFeeBps,
    slippageBps: Math.max(0, totalBps.minus(venueFeeBps).toNumber()),
  };
}

export async function liveCombinedQuoteForRlusdOut(
  rlusdOut: string,
): Promise<LiveXrplQuote | null> {
  try {
    return await withXrpl((client) => combinedQuoteForRlusdOut(client, rlusdOut));
  } catch (err) {
    logger.warn({ err }, "xrpl combined quote unavailable — no live combined route this run");
    return null;
  }
}
