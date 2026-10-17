import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  prepareExecute,
  submitExecute,
  listEvents,
  paymentStatus,
  publicConfig,
  paymentReady,
} from "@/lib/paiflow";
import { handle } from "@/lib/http";
import { envelopeHash } from "@/lib/transaction";
import {
  fixtureAddress as from,
  fixturePrepared as prepared,
  capabilities,
  deployment,
  ok,
} from "./sdk-fixtures";
const mockFetch = vi.fn<typeof fetch>();
const token = `pfd_${"a".repeat(64)}`;
const hash = envelopeHash(prepared.xdr);
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  vi.stubEnv("PAIFLOW_MODE", "team");
  vi.stubEnv("PAIFLOW_BASE_URL", "http://localhost:3000");
  vi.stubEnv("PAIFLOW_API_TOKEN", token);
  vi.stubEnv("PAIFLOW_DEPLOYMENT_ID", deployment);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each(["pfd_", "pfk_"])(
  "supports %s credentials through the published SDK and preserves preparation correlation",
  async (prefix) => {
    vi.stubEnv("PAIFLOW_API_TOKEN", prefix + "a".repeat(64));
    mockFetch.mockImplementation(async (url) =>
      String(url).endsWith("/capabilities")
        ? ok(capabilities)
        : ok(prepared, {
            "x-history-request-id": "22222222-2222-4222-8222-222222222222",
          }),
    );
    expect(await prepareExecute({ from, amount: "35000000" })).toEqual({
      ...prepared,
      txHash: hash,
      preparationRequestId: "22222222-2222-4222-8222-222222222222",
    });
    const [url, options] = mockFetch.mock.calls[1]!;
    expect(String(url)).toBe(
      `http://localhost:3000/api/v1/deployments/${deployment}/execute`,
    );
    expect(new Headers(options?.headers).get("authorization")).toBe(
      `Bearer ${prefix}${"a".repeat(64)}`,
    );
    expect(JSON.parse(options!.body as string)).toEqual({
      from,
      amount: "35000000",
    });
    expect(JSON.stringify(publicConfig())).not.toContain("a".repeat(64));
  },
);
it.each(["SUCCESS", "PENDING", "FAILED"])(
  "preserves HTTP 200 %s and forwards the exact original envelope and preparation ID",
  async (status) => {
    mockFetch.mockImplementation(async (url) =>
      ok(
        String(url).endsWith("/capabilities")
          ? capabilities
          : { txHash: hash, status },
      ),
    );
    expect(
      await submitExecute({
        signedXdr: prepared.xdr,
        preparationRequestId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual({ txHash: hash, status });
    const [url, options] = mockFetch.mock.calls[1]!;
    expect(String(url)).toContain("execute/submit?wait=false");
    expect(options?.body).toBe(JSON.stringify({ signedXdr: prepared.xdr }));
    expect(new Headers(options?.headers).get("x-preparation-request-id")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  },
);
it.each([
  { network: "mainnet" },
  { inputAsset: { kind: "native" } },
  { inputAsset: { kind: "custom", code: "USDC", issuer: from } },
  { triggerType: "schedule" },
  {
    operations: {
      ...capabilities.operations,
      execute: {
        status: "unsupported",
        authentication: "deployment_token",
        requirements: [],
        nodeIds: [],
      },
    },
  },
])(
  "refuses incompatible deployments before requesting a payment: %j",
  async (change) => {
    mockFetch.mockResolvedValue(ok({ ...capabilities, ...change }));
    await expect(paymentReady()).rejects.toThrow("active testnet USDC");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  },
);
it("supports exact custom Circle USDC without accepting another issuer", async () => {
  mockFetch.mockResolvedValue(
    ok({
      ...capabilities,
      inputAsset: {
        kind: "custom",
        code: "USDC",
        issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      },
    }),
  );
  await expect(paymentReady()).resolves.toBeDefined();
});
it("preserves cursor pagination and transaction filters", async () => {
  const page = { items: [], nextCursor: "opaque+/=", hasMore: true };
  mockFetch.mockImplementation(async () => ok(page));
  expect(
    await listEvents({ cursor: "opaque+/=", limit: 50, txHash: hash }),
  ).toEqual(page);
  const url = new URL(String(mockFetch.mock.calls[0]![0]));
  expect(url.searchParams.get("cursor")).toBe("opaque+/=");
  expect(url.searchParams.get("txHash")).toBe(hash);
  await listEvents({ cursor: "" });
  expect(String(mockFetch.mock.calls[1]![0])).not.toContain("cursor=");
});
it("keeps UNKNOWN unresolved and rejects unrelated transaction evidence", async () => {
  mockFetch.mockResolvedValue(
    ok({ txHash: hash, network: "testnet", status: "UNKNOWN" }),
  );
  expect((await paymentStatus(hash)).status).toBe("UNKNOWN");
  mockFetch.mockResolvedValue(
    ok({ txHash: "b".repeat(64), network: "testnet", status: "SUCCESS" }),
  );
  await expect(paymentStatus(hash)).rejects.toThrow("evidence mismatch");
});
it.each([409, 429, 502])(
  "forwards SDK HTTP %s diagnostics without dropping request IDs or Retry-After",
  async (status) => {
    const error = {
      code: status === 429 ? "RATE_LIMITED" : "UPSTREAM_RPC",
      message: "Wait for finality",
    };
    mockFetch.mockResolvedValue(
      Response.json(
        { error },
        {
          status,
          headers: { "Retry-After": "12", "x-request-id": "request-123" },
        },
      ),
    );
    const response = await handle(() => listEvents());
    expect(response.status).toBe(status);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(await response.json()).toEqual({ error });
  },
);
it("redacts unexpected upstream response bodies", async () => {
  mockFetch.mockResolvedValue(new Response(`secret ${token}`, { status: 502 }));
  expect(await (await handle(() => listEvents())).text()).not.toContain(token);
});
it.each([undefined, "prepare"])(
  "makes no upstream calls in %s mode even with credentials",
  async (mode) => {
    vi.stubEnv("PAIFLOW_MODE", mode);
    expect(publicConfig()).toEqual({ mode: "prepare", deploymentUrl: null });
    for (const action of [
      () => prepareExecute({ from, amount: "1" }),
      () => submitExecute({ signedXdr: prepared.xdr }),
      () => listEvents(),
      () => paymentStatus(hash),
    ])
      await expect(action()).rejects.toMatchObject({
        status: 403,
        api: { code: "PREPARATION_MODE" },
      });
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
it.each(["demo", "invalid", ""])(
  "rejects unsupported mode %s without demo access",
  async (mode) => {
    vi.stubEnv("PAIFLOW_MODE", mode);
    expect(publicConfig()).toMatchObject({ mode: "disabled" });
    await expect(listEvents()).rejects.toMatchObject({ status: 503 });
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
it.each([
  ["PAIFLOW_API_TOKEN", ""],
  ["PAIFLOW_API_TOKEN", "not-a-token"],
  ["PAIFLOW_DEPLOYMENT_ID", "not-a-uuid"],
  ["PAIFLOW_BASE_URL", "https://user:password@example.com"],
  ["PAIFLOW_BASE_URL", "https://example.com/path"],
  ["PAIFLOW_BASE_URL", "http://example.com"],
])("rejects invalid %s configuration", async (name, value) => {
  vi.stubEnv(name, value);
  expect(publicConfig()).toMatchObject({ mode: "disabled" });
  await expect(listEvents()).rejects.toMatchObject({ status: 503 });
  expect(mockFetch).not.toHaveBeenCalled();
});

it("rejects an unrelated submission hash and retains the original envelope for status recovery", async () => {
  mockFetch.mockImplementation(async (url) =>
    ok(
      String(url).endsWith("/capabilities")
        ? capabilities
        : { txHash: "b".repeat(64), status: "SUCCESS" },
    ),
  );
  await expect(submitExecute({ signedXdr: prepared.xdr })).rejects.toThrow(
    "hash mismatch",
  );
});
