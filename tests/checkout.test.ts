import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MENU, menuItem, priceBreakdown } from "@/lib/menu";
import { POST } from "@/app/api/pay/route";
import { GET } from "@/app/api/events/route";
import { storeConfig } from "@/lib/checkout";

const from = `G${"A".repeat(55)}`;
const token = `pfk_${"b".repeat(64)}`;
const deployment = "11111111-1111-4111-8111-111111111111";
const mockFetch = vi.fn<typeof fetch>();
const request = (body: unknown) =>
  new Request("http://localhost/api/pay", {
    method: "POST",
    body: JSON.stringify(body),
  });
const ok = (data: unknown) => Response.json({ data });

beforeEach(() => {
  mockFetch.mockReset();
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
    xdr: "unsigned",
    network: "testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    expiresAt: "2026-10-03T12:03:00Z",
  };
  mockFetch.mockResolvedValue(ok(prepared));
  const response = await POST(request({ from, itemId: "snack-combo" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: prepared });
  const [url, options] = mockFetch.mock.calls[0]!;
  expect(String(url)).toBe(
    `https://beta.app.paiflow.xyz/api/v1/deployments/${deployment}/execute`,
  );
  expect(JSON.parse(options!.body as string)).toEqual({
    from,
    amount: "35000000",
  });
  expect(JSON.stringify(options?.headers)).toContain(token);
});

it.each(["PENDING", "FAILED", "SUCCESS"])(
  "retains %s as the payment outcome, including HTTP 200 failures",
  async (status) => {
    const submitted = { txHash: "a".repeat(64), status };
    mockFetch.mockResolvedValue(ok(submitted));
    const response = await POST(request({ signedXdr: "same-envelope" }));
    expect(await response.json()).toEqual({ data: submitted });
    expect(String(mockFetch.mock.calls[0]![0])).toContain(
      "execute/submit?wait=true",
    );
    expect(mockFetch.mock.calls[0]![1]?.body).toBe(
      '{"signedXdr":"same-envelope"}',
    );
  },
);

it("rechecks precisely the same envelope after an uncertain submission error", async () => {
  mockFetch
    .mockRejectedValueOnce(new Error("Transport lost"))
    .mockResolvedValueOnce(ok({ txHash: "a".repeat(64), status: "SUCCESS" }));
  expect((await POST(request({ signedXdr: "same-envelope" }))).status).toBe(
    502,
  );
  expect((await POST(request({ signedXdr: "same-envelope" }))).status).toBe(
    200,
  );
  expect(mockFetch.mock.calls[0]![1]?.body).toBe(
    mockFetch.mock.calls[1]![1]?.body,
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
