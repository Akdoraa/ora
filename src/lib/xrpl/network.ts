import { env } from "@/env";

export type XrplNetwork = "testnet" | "devnet" | "mainnet";

/** CAIP-2-style identifiers used by the x402 `exact` scheme. */
export const XRPL_CAIP2: Record<XrplNetwork, string> = {
  mainnet: "xrpl:0",
  testnet: "xrpl:1",
  devnet: "xrpl:2",
};

export const NETWORK: XrplNetwork = env.XRPL_NETWORK;
export const NETWORK_CAIP2 = XRPL_CAIP2[NETWORK];

export const WSS_URL = env.XRPL_WSS_URL;
export const RPC_URL = env.XRPL_RPC_URL;

const EXPLORER_BASE: Record<XrplNetwork, string> = {
  mainnet: "https://livenet.xrpl.org",
  testnet: "https://testnet.xrpl.org",
  devnet: "https://devnet.xrpl.org",
};

export function explorerTxUrl(hash: string, network: XrplNetwork = NETWORK): string {
  return `${EXPLORER_BASE[network]}/transactions/${hash}`;
}

export function explorerAccountUrl(
  address: string,
  network: XrplNetwork = NETWORK,
): string {
  return `${EXPLORER_BASE[network]}/accounts/${address}`;
}

export const FAUCET_URL =
  NETWORK === "devnet"
    ? "https://faucet.devnet.rippletest.net/accounts"
    : "https://faucet.altnet.rippletest.net/accounts";

export const isTestOrDev = NETWORK !== "mainnet";
