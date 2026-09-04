import { Client } from "xrpl";
import { WSS_URL } from "./network";
import { logger } from "@/lib/logger";

declare global {
  var __oraXrplClient: Client | undefined;
}

/**
 * One shared, lazily-connected XRPL client. XRPL keeps a websocket open; we
 * reuse it across requests and reconnect on demand.
 */
export async function getXrplClient(): Promise<Client> {
  let client = globalThis.__oraXrplClient;
  if (!client) {
    client = new Client(WSS_URL, { timeout: 20_000 });
    client.on("error", (err) => logger.warn({ err }, "xrpl client error"));
    globalThis.__oraXrplClient = client;
  }
  if (!client.isConnected()) {
    await client.connect();
    logger.info({ url: WSS_URL }, "xrpl connected");
  }
  return client;
}

export async function withXrpl<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await getXrplClient();
  return fn(client);
}

export async function disconnectXrpl(): Promise<void> {
  const client = globalThis.__oraXrplClient;
  if (client?.isConnected()) await client.disconnect();
}
