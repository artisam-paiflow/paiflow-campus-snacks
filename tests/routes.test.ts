import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { paymentBody, handle } from "@/lib/http";
const from = `G${"A".repeat(55)}`;
const request = (body: unknown) =>
  new Request("http://localhost/api/pay", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("PAIFLOW_API_TOKEN", "");
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  null,
  [],
  {},
  { from, amount: 1 },
  { from, amount: "0" },
  { from, amount: "1.5" },
  { from: "secret", amount: "1" },
  { from, amount: (1n << 127n).toString() },
  { signedXdr: "" },
  { signedXdr: "signed", amount: "1" },
])("refuses malformed payment body %j", async (body) => {
  const response = await handle(() => paymentBody(request(body)));
  expect(response.status).toBe(422);
});
it("refuses malformed recipients and accepts documented payout bodies", async () => {
  await expect(
    paymentBody(request({ from, amount: "1", recipient: "S-secret" }), true),
  ).rejects.toThrow();
  expect(
    await paymentBody(
      request({ from, amount: "1", recipient: from, nodeId: "pay" }),
      true,
    ),
  ).toEqual({ from, amount: "1", recipient: from, nodeId: "pay" });
});
it("blocks demo payout and rejects invalid cursors before upstream calls", async () => {
  const { POST } = await import("@/app/api/payout/route");
  expect((await POST(request({ signedXdr: "signed" }))).status).toBe(422);
  const { GET } = await import("@/app/api/events/route");
  expect(
    (await GET(new Request("http://localhost/api/events?cursor="))).status,
  ).toBe(422);
  expect(
    (await GET(new Request("http://localhost/api/events?token=bad"))).status,
  ).toBe(422);
});
