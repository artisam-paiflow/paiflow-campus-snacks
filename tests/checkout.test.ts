import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MENU, menuItem, priceBreakdown } from "@/lib/menu";
import { POST } from "@/app/api/pay/route";
import { GET } from "@/app/api/events/route";
import { storeConfig } from "@/lib/checkout";

import {
  fixtureAddress as from,
  fixturePrepared,
  capabilities,
} from "./sdk-fixtures";
import { envelopeHash } from "@/lib/transaction";
const token = `pfk_${"b".repeat(64)}`;
const deployment = "11111111-1111-4111-8111-111111111111";
const mockFetch = vi.fn<typeof fetch>();
const request = (body: unknown) =>
  new Request("http://localhost/api/pay", {
    method: "POST",
    headers: { origin: "http://localhost" },
    body: JSON.stringify(body),
  });
const ok = (data: unknown) => Response.json({ data });

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url) =>
    String(url).endsWith("/capabilities")
      ? ok(capabilities)
      : ok(fixturePrepared),
  );
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("PAIFLOW_MODE", "team");
  vi.stubEnv("PAIFLOW_BASE_URL", "https://beta.app.paiflow.xyz");
  vi.stubEnv("PAIFLOW_API_TOKEN", token);
  vi.stubEnv("PAIFLOW_DEPLOYMENT_ID", deployment);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ["iced-tea", "15000000", "1.35", "0.15"],
  ["cheese-bread", "20000000", "1.8", "0.2"],
  ["snack-combo", "35000000", "3.15", "0.35"],
])(
  "prices %s in exact stroops and previews a 90/10 split",
  (id, amount, vendor, studentOrg) => {
    expect(priceBreakdown(menuItem(id))).toEqual({
      amount,
      vendor,
      studentOrg,
    });
  },
);

it("preserves all stroops when the percentage multiplication rounds down", () => {
  const item = { ...MENU[0], price: "0.0000001" };
  expect(priceBreakdown(item)).toEqual({
    amount: "1",
    vendor: "0",
    studentOrg: "0.0000001",
  });
});

it.each([
  null,
  [],
  {},
  { from, itemId: "fake-snack" },
  { from, itemId: 0 },
  { from: "S-secret", itemId: "iced-tea" },
  { itemId: "iced-tea" },
  { from, itemId: "iced-tea", amount: "1" },
  { from, itemId: "iced-tea", recipient: from },
  { signedXdr: "" },
  { signedXdr: "signed", itemId: "iced-tea" },
])(
  "rejects malformed orders and browser price/recipient overrides: %j",
  async (body) => {
    expect((await POST(request(body))).status).toBe(422);
    expect(mockFetch).not.toHaveBeenCalled();
  },
);

it("refuses malformed JSON without contacting Paiflow", async () => {
  expect(
    (
      await POST(
        new Request("http://localhost/api/pay", { method: "POST", body: "{" }),
      )
    ).status,
  ).toBe(422);
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each(["", "  "])(
  "disables all payment/event calls with missing token %j without minting a demo token",
  async (value) => {
    vi.stubEnv("PAIFLOW_API_TOKEN", value);
    expect(storeConfig()).toMatchObject({
      ready: false,
      mode: "disabled",
      deploymentUrl: null,
    });
    expect((await POST(request({ from, itemId: "iced-tea" }))).status).toBe(
      503,
    );
    expect((await POST(request({ signedXdr: "signed" }))).status).toBe(503);
    expect((await GET(new Request("http://localhost/api/events"))).status).toBe(
      503,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  },
);

it("requires a deployment ID alongside the token and never sends the token to the browser", () => {
  expect(storeConfig()).toEqual({
    ready: true,
    mode: "team",
    deploymentUrl: `https://beta.app.paiflow.xyz/deployments/${deployment}`,
    scope: `https://beta.app.paiflow.xyz/${deployment}`,
  });
  expect(JSON.stringify(storeConfig())).not.toContain(token);
  vi.stubEnv("PAIFLOW_DEPLOYMENT_ID", "");
  expect(storeConfig()).toMatchObject({
    ready: false,
    mode: "disabled",
    deploymentUrl: null,
  });
});

it("prepares a catalog price on the server instead of accepting an arbitrary amount", async () => {
  const prepared = {
    ...fixturePrepared,
    txHash: envelopeHash(fixturePrepared.xdr),
  };
  const response = await POST(request({ from, itemId: "snack-combo" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: prepared });
  const [url, options] = mockFetch.mock.calls[1]!;
  expect(String(url)).toBe(
    `https://beta.app.paiflow.xyz/api/v1/deployments/${deployment}/execute`,
  );
  expect(JSON.parse(options!.body as string)).toEqual({
    from,
    amount: "35000000",
  });
  expect(new Headers(options?.headers).get("authorization")).toBe(
    `Bearer ${token}`,
  );
});

it.each(["PENDING", "FAILED", "SUCCESS"])(
  "retains %s as the payment outcome, including HTTP 200 failures",
  async (status) => {
    const submitted = { txHash: envelopeHash(fixturePrepared.xdr), status };
    mockFetch.mockImplementation(async (url) =>
      ok(String(url).endsWith("/capabilities") ? capabilities : submitted),
    );
    const response = await POST(request({ signedXdr: fixturePrepared.xdr }));
    expect(await response.json()).toEqual({ data: submitted });
    expect(String(mockFetch.mock.calls[1]![0])).toContain(
      "execute/submit?wait=false",
    );
    expect(mockFetch.mock.calls[1]![1]?.body).toBe(
      JSON.stringify({ signedXdr: fixturePrepared.xdr }),
    );
  },
);

it("rechecks precisely the same envelope after an uncertain submission error", async () => {
  let submits = 0;
  mockFetch.mockImplementation(async (url) => {
    if (String(url).endsWith("/capabilities")) return ok(capabilities);
    if (++submits === 1) throw new Error("Transport lost");
    return ok({ txHash: envelopeHash(fixturePrepared.xdr), status: "SUCCESS" });
  });
  expect((await POST(request({ signedXdr: fixturePrepared.xdr }))).status).toBe(
    502,
  );
  expect((await POST(request({ signedXdr: fixturePrepared.xdr }))).status).toBe(
    200,
  );
  expect(mockFetch.mock.calls[1]![1]?.body).toBe(
    mockFetch.mock.calls[3]![1]?.body,
  );
});

it.each([undefined, "prepare"])(
  "blocks direct payment and event routes in %s mode",
  async (mode) => {
    vi.stubEnv("PAIFLOW_MODE", mode);
    expect(storeConfig()).toEqual({
      ready: false,
      mode: "prepare",
      deploymentUrl: null,
    });
    for (const response of [
      await POST(request({ from, itemId: "iced-tea" })),
      await POST(request({ signedXdr: "same" })),
      await GET(new Request("http://localhost/api/events")),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "PREPARATION_MODE" },
      });
    }
    expect(mockFetch).not.toHaveBeenCalled();
  },
);

it("rejects missing or foreign Origin before contacting the SDK", async () => {
  for (const origin of [undefined, "https://other.example"]) {
    const response = await POST(
      new Request("http://localhost/api/pay", {
        method: "POST",
        headers: origin ? { origin } : {},
        body: JSON.stringify({ from, itemId: "snack-combo" }),
      }),
    );
    expect(response.status).toBe(422);
  }
  expect(mockFetch).not.toHaveBeenCalled();
});

it("rejects invalid status hashes, oversized requests and malformed preparation metadata before contacting the SDK", async () => {
  for (const body of [
    { action: "status", txHash: "bad" },
    { action: "status", txHash: "a".repeat(64), amount: "1" },
    { signedXdr: fixturePrepared.xdr, preparationRequestId: 3 },
    { from, itemId: "snack-combo", padding: "x".repeat(210001) },
  ])
    expect((await POST(request(body))).status).toBe(422);
  expect(mockFetch).not.toHaveBeenCalled();
});
