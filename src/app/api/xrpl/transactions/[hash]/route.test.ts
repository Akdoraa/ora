import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyTransactionByHash = vi.fn();
vi.mock("@/lib/xrpl/verify", () => ({
  verifyTransactionByHash: (...args: unknown[]) => verifyTransactionByHash(...args),
}));

const { GET } = await import("./route");

function req() {
  return new NextRequest("http://localhost/x");
}
function ctx(hash: string) {
  return { params: Promise.resolve({ hash }) };
}

const VALID_HASH = "A".repeat(64);

beforeEach(() => {
  verifyTransactionByHash.mockReset();
});

describe("GET /api/xrpl/transactions/:hash", () => {
  it("400s a malformed hash without ever calling the verifier", async () => {
    const res = await GET(req(), ctx("not-a-hash"));
    expect(res.status).toBe(400);
    expect(verifyTransactionByHash).not.toHaveBeenCalled();
  });

  it("400s a hash of the wrong length", async () => {
    const res = await GET(req(), ctx("AB".repeat(30)));
    expect(res.status).toBe(400);
  });

  it("upper-cases the hash before verifying (XRPL hashes are canonically upper-case)", async () => {
    verifyTransactionByHash.mockResolvedValue({ found: true, validated: true });
    const lower = VALID_HASH.toLowerCase();
    await GET(req(), ctx(lower));
    expect(verifyTransactionByHash).toHaveBeenCalledWith(VALID_HASH);
  });

  it("200s a found transaction", async () => {
    verifyTransactionByHash.mockResolvedValue({ found: true, validated: true, engineResult: "tesSUCCESS" });
    const res = await GET(req(), ctx(VALID_HASH));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.validated).toBe(true);
  });

  it("404s a not-found transaction", async () => {
    verifyTransactionByHash.mockResolvedValue({ found: false });
    const res = await GET(req(), ctx(VALID_HASH));
    expect(res.status).toBe(404);
  });
});
