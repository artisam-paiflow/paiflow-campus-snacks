import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mockFetch = vi.fn<typeof fetch>();
const prepared = {
  xdr: "unsigned",
  networkPassphrase: "Test SDF Network ; September 2015",
  network: "testnet",
  expiresAt: "2026-10-01T12:03:00Z",
};
const from = `G${"A".repeat(55)}`;
const token = `pfk_${"a".repeat(64)}`;
const deployment = "11111111-1111-4111-8111-111111111111";
const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status });
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("__paiflowDemoCache", undefined);
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("PAIFLOW_MODE", "team");
  vi.stubEnv("PAIFLOW_BASE_URL", "http://localhost:3000");
  vi.stubEnv("PAIFLOW_API_TOKEN", token);
  vi.stubEnv("PAIFLOW_DEPLOYMENT_ID", deployment);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("typed Paiflow client (llms.md §4)", () => {
  it("prepares execute with bearer only in the upstream server request", async () => {
    mockFetch.mockResolvedValue(ok(prepared));
    const api = await import("@/lib/paiflow");
    expect(await api.prepareExecute({ from, amount: "10000000" })).toEqual(
      prepared,
    );
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(String(url)).toBe(
      `http://localhost:3000/api/v1/deployments/${deployment}/execute`,
    );
    expect(options?.headers).toEqual({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(options!.body as string)).toEqual({
      from,
      amount: "10000000",
    });
    expect(JSON.stringify(api.publicConfig())).not.toContain(token);
  });
  it.each(["SUCCESS", "PENDING", "FAILED"] as const)(
    "preserves HTTP 200 %s submission",
    async (status) => {
      const submitted = {
        txHash: "a".repeat(64),
        status,
        ...(status === "FAILED"
          ? { error: { code: "txBadAuth", message: "Signature missing" } }
          : {}),
      };
      mockFetch.mockResolvedValue(ok(submitted));
      const api = await import("@/lib/paiflow");
      expect(
        await api.submitExecute({ signedXdr: "same-envelope" }, false),
      ).toEqual(submitted);
      expect(String(mockFetch.mock.calls[0]![0])).toContain(
        "execute/submit?wait=false",
      );
    },
  );
  it("uses cursor/limit/txHash unchanged; omits empty cursor", async () => {
    const page = {
      items: [
        {
          id: "1",
          eventId: "event-1",
          kind: "PAYOUT",
          topic: "swap",
          ledger: 1,
          txHash: "a".repeat(64),
          occurredAt: "2026-10-01T12:00:00Z",
          data: { amountIn: "10000000" },
        },
      ],
      nextCursor: "opaque+/=",
      hasMore: true,
    };
    mockFetch.mockImplementation(async () => ok(page));
    const api = await import("@/lib/paiflow");
    expect(
      await api.listEvents({
        cursor: "opaque+/=",
        limit: 50,
        txHash: "a".repeat(64),
      }),
    ).toEqual(page);
    expect(
      new URL(String(mockFetch.mock.calls[0]![0])).searchParams.get("cursor"),
    ).toBe("opaque+/=");
    await api.listEvents({ cursor: "" });
    expect(String(mockFetch.mock.calls[1]![0])).not.toContain("cursor=");
  });
  it("prepares payout with optional nodeId and submits the exact envelope", async () => {
    const payout = {
      ...prepared,
      nodeId: "pay",
      expiresAt: "2026-10-01T12:01:00Z",
    };
    mockFetch
      .mockResolvedValueOnce(ok(payout))
      .mockResolvedValueOnce(ok({ txHash: "b".repeat(64), status: "PENDING" }))
      .mockResolvedValueOnce(
        ok({ txHash: "b".repeat(64), status: "SUCCESS", ledger: 42 }),
      );
    const api = await import("@/lib/paiflow");
    expect(
      await api.preparePayout({
        from,
        amount: "10000000",
        recipient: from,
        nodeId: "pay",
      }),
    ).toEqual(payout);
    expect(JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)).toEqual({
      from,
      amount: "10000000",
      recipient: from,
      nodeId: "pay",
    });
    expect(String(mockFetch.mock.calls[0]![0])).toMatch(/\/payouts$/);
    expect((await api.submitPayout({ signedXdr: "same" })).status).toBe(
      "PENDING",
    );
    expect((await api.submitPayout({ signedXdr: "same" })).status).toBe(
      "SUCCESS",
    );
    expect(mockFetch.mock.calls[1]![1]!.body).toBe(
      mockFetch.mock.calls[2]![1]!.body,
    );
    expect(String(mockFetch.mock.calls[1]![0])).toMatch(
      /payouts\/submit\?wait=true$/,
    );
  });
  it("releaseEarly sends only the documented request", async () => {
    mockFetch.mockResolvedValue(
      ok({ nodeId: "deadline", txHash: "c".repeat(64) }),
    );
    const api = await import("@/lib/paiflow");
    await api.releaseEarly({ nodeId: "deadline" });
    expect(String(mockFetch.mock.calls[0]![0])).toMatch(/release-early$/);
    expect(mockFetch.mock.calls[0]![1]!.body).toBe('{"nodeId":"deadline"}');
  });
  it.each([409, 429, 502])(
    "retains HTTP %s, code, Retry-After and request id through the proxy",
    async (status) => {
      const error = {
        code:
          status === 429
            ? "RATE_LIMITED"
            : status === 409
              ? "CONFLICT"
              : "UPSTREAM_RPC",
        message: "Wait for finality",
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error }), {
          status,
          headers: { "Retry-After": "12", "x-request-id": "request-123" },
        }),
      );
      const api = await import("@/lib/paiflow");
      const { handle } = await import("@/lib/http");
      const response = await handle(() =>
        api.preparePayout({ from, amount: "1", recipient: from }),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Retry-After")).toBe("12");
      expect(response.headers.get("x-request-id")).toBe("request-123");
      expect(await response.json()).toEqual({ error });
    },
  );
  it("redacts unexpected upstream response bodies", async () => {
    mockFetch.mockResolvedValue(
      new Response(`secret ${token}`, { status: 502 }),
    );
    const api = await import("@/lib/paiflow");
    const { handle } = await import("@/lib/http");
    const response = await handle(() => api.listEvents());
    expect(await response.text()).not.toContain(token);
  });
});
describe("integration guards", () => {
  it.each([undefined, "prepare"])(
    "does not call upstream in %s mode despite credentials",
    async (mode) => {
      vi.stubEnv("PAIFLOW_MODE", mode);
      const api = await import("@/lib/paiflow");
      expect(api.publicConfig()).toEqual({
        mode: "prepare",
        deploymentUrl: null,
      });
      for (const operation of [
        () => api.prepareExecute({ from, amount: "1" }),
        () => api.submitExecute({ signedXdr: "same" }),
        () => api.listEvents(),
        () => api.preparePayout({ from, amount: "1", recipient: from }),
        () => api.releaseEarly(),
      ]) {
        await expect(operation()).rejects.toMatchObject({
          status: 403,
          api: { code: "PREPARATION_MODE" },
        });
      }
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
  it.each(["demo", "invalid", ""])(
    "rejects unsupported mode %s without demo minting",
    async (mode) => {
      vi.stubEnv("PAIFLOW_MODE", mode);
      const api = await import("@/lib/paiflow");
      expect(api.publicConfig()).toMatchObject({
        mode: "disabled",
        deploymentUrl: null,
      });
      await expect(api.listEvents()).rejects.toMatchObject({
        status: 503,
        api: { code: "CONFIGURATION" },
      });
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["PAIFLOW_API_TOKEN", ""],
    ["PAIFLOW_API_TOKEN", "not-a-token"],
    ["PAIFLOW_DEPLOYMENT_ID", "not-a-uuid"],
    ["PAIFLOW_BASE_URL", "https://user:password@example.com"],
    ["PAIFLOW_BASE_URL", "https://example.com/path"],
  ])("rejects invalid %s", async (name, value) => {
    vi.stubEnv(name, value);
    const api = await import("@/lib/paiflow");
    expect(api.publicConfig()).toMatchObject({ mode: "disabled" });
    await expect(api.listEvents()).rejects.toMatchObject({ status: 503 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
