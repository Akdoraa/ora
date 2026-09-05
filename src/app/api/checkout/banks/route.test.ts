import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

function req(country?: string) {
  const url = new URL("http://localhost/api/checkout/banks");
  if (country) url.searchParams.set("country", country);
  return new NextRequest(url);
}

describe("GET /api/checkout/banks", () => {
  it("lists GB banks by default", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body.banks.map((b: { id: string }) => b.id)).toContain("gb-monzo");
  });

  it("lists SG banks when asked", async () => {
    const res = await GET(req("SG"));
    const body = await res.json();
    expect(body.banks.map((b: { id: string }) => b.id)).toContain("sg-dbs");
  });
});
