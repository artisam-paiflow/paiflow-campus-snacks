import { describe, expect, it } from "vitest";
import { formatStroops } from "@/lib/amount";
import { jarScale, jarTotals } from "@/lib/jar-totals";
import type { EventItem } from "@/lib/paiflow";

const vendor = `G${"A".repeat(55)}`;
const org = `G${"B".repeat(55)}`;
const recipients = () => [
  { address: vendor, bps: 9000, amount: "0", is_cash_out: false },
  { address: org, bps: 1000, amount: "0", is_cash_out: false },
];
function event(kind: string, data: unknown, txHash = "tx-1"): EventItem {
  return {
    id: `${txHash}-${kind}`,
    eventId: `${txHash}-${kind}`,
    kind,
    data,
    topic: kind === "RECEIVE" ? "deposit" : "payout",
    ledger: 1,
    txHash,
    occurredAt: "2026-10-04T00:00:00Z",
  };
}
const deposit = (amount = "35000000", tx = "tx-1") =>
  event("RECEIVE", { asset: "USDC", amount }, tx);
const payout = (tx = "tx-1") =>
  event("PAYOUT", { recipients: recipients() }, tx);

describe("confirmed jar contributions", () => {
  it("matches the live percentage roster, not its zero configured amounts", () => {
    const result = jarTotals([deposit(), payout()]);
    expect(result.vendorStroops).toBe("31500000");
    expect(result.studentOrgStroops).toBe("3500000");
    expect(result.payments).toHaveLength(1);
    expect(result.unresolved).toBe(0);
  });
  it("counts each event once across retries and out-of-order pages", () => {
    const result = jarTotals([
      payout(),
      deposit(),
      payout(),
      deposit(),
      payout("tx-2"),
      deposit("35000000", "tx-2"),
    ]);
    expect(result.vendorStroops).toBe("63000000");
    expect(result.studentOrgStroops).toBe("7000000");
    expect(result.payments).toHaveLength(2);
  });
  it("waits for matching payout evidence rather than filling on RECEIVE alone", () => {
    expect(jarTotals([deposit()])).toMatchObject({
      vendorStroops: "0",
      studentOrgStroops: "0",
      unresolved: 1,
    });
    expect(jarTotals([payout()]).payments).toHaveLength(0);
    expect(
      jarTotals([deposit(), payout("different-tx")]).payments,
    ).toHaveLength(0);
  });
  it("keeps per-payment rounding instead of splitting aggregate sales", () => {
    const result = jarTotals([
      deposit("1"),
      payout(),
      deposit("1", "tx-2"),
      payout("tx-2"),
    ]);
    expect(result.vendorStroops).toBe("0");
    expect(result.studentOrgStroops).toBe("2");
  });
  it("gives the last recipient the remainder even if the roster is reversed", () => {
    const result = jarTotals([
      deposit("11"),
      event("PAYOUT", { recipients: recipients().reverse() }),
    ]);
    expect(result.vendorStroops).toBe("10");
    expect(result.studentOrgStroops).toBe("1");
  });
  it("formats cumulative contributions and scales beyond the transaction limit", () => {
    const amount = ((1n << 127n) - 1n).toString();
    const totals = jarTotals([
      deposit(amount),
      event("PAYOUT", { recipients: recipients().reverse() }),
      deposit(amount, "tx-2"),
      event("PAYOUT", { recipients: recipients().reverse() }, "tx-2"),
    ]);
    expect(BigInt(totals.vendorStroops)).toBeGreaterThan(BigInt(amount));
    expect(formatStroops(totals.vendorStroops)).toBe(
      "34028236692093846346337460743176.8211454",
    );
    expect(() =>
      formatStroops(
        jarScale(totals.vendorStroops, totals.studentOrgStroops)
          .capacityStroops,
      ),
    ).not.toThrow();
  });
  it("matches checked contract multiplication at the i128 boundary", () => {
    const amount = ((1n << 127n) - 1n).toString();
    expect(jarTotals([deposit(amount), payout()])).toMatchObject({
      vendorStroops: "0",
      studentOrgStroops: amount,
    });
  });
  it("preserves amounts above Number.MAX_SAFE_INTEGER", () => {
    expect(
      jarTotals([deposit("90071992547409931234567"), payout()]),
    ).toMatchObject({
      vendorStroops: "81064793292668938111110",
      studentOrgStroops: "9007199254740993123457",
    });
  });
  it.each([
    null,
    {},
    [],
    { asset: "XLM", amount: "35000000" },
    { asset: "USDC", amount: 35000000 },
    { asset: "USDC", amount: "-1" },
    { asset: "USDC", amount: "0" },
    { asset: "USDC", amount: "1.5" },
    { asset: "USDC", amount: "9".repeat(40) },
  ])("omits invalid payment data %j", (data) => {
    expect(jarTotals([event("RECEIVE", data), payout()]).payments).toHaveLength(
      0,
    );
  });
  it.each([
    null,
    {},
    { recipients: [] },
    { recipients: recipients().slice(0, 1) },
    { recipients: recipients().map((r) => ({ ...r, bps: 5000 })) },
    { recipients: recipients().map((r) => ({ ...r, address: vendor })) },
    { recipients: recipients().map((r) => ({ ...r, amount: "10" })) },
    { recipients: recipients().map((r) => ({ ...r, is_cash_out: true })) },
    { recipients: recipients().map((r) => ({ ...r, address: "invalid" })) },
  ])("omits unsupported payout data %j", (data) => {
    expect(jarTotals([deposit(), event("PAYOUT", data)]).payments).toHaveLength(
      0,
    );
  });
  it("refuses ambiguous multiple deposits or payouts in one tx", () => {
    expect(
      jarTotals([
        deposit(),
        { ...deposit(), eventId: "second-deposit" },
        payout(),
      ]).payments,
    ).toHaveLength(0);
    expect(
      jarTotals([
        deposit(),
        payout(),
        { ...payout(), eventId: "second-payout" },
      ]).payments,
    ).toHaveLength(0);
  });
  it("ignores unrelated status events and swap payouts", () => {
    expect(jarTotals([event("STATUS_CHANGE", {})]).unresolved).toBe(0);
    expect(
      jarTotals([deposit(), { ...payout(), topic: "swap" }]).payments,
    ).toHaveLength(0);
  });
});

describe("shared jar scale", () => {
  it("starts empty and shows both totals on the same 10 USDC scale", () => {
    expect(jarScale("0", "0")).toEqual({
      capacityStroops: "100000000",
      vendorCoins: 0,
      studentOrgCoins: 0,
    });
    expect(jarScale("63000000", "7000000")).toEqual({
      capacityStroops: "100000000",
      vendorCoins: 31,
      studentOrgCoins: 4,
    });
  });
  it("expands both jars together without clipping large contributions", () => {
    expect(jarScale("180000000", "20000000")).toEqual({
      capacityStroops: "200000000",
      vendorCoins: 44,
      studentOrgCoins: 5,
    });
    const large = jarScale(
      "90071992547409931234567",
      "10007999171934436803841",
    );
    expect(large.vendorCoins).toBeLessThanOrEqual(48);
    expect(large.vendorCoins).toBeGreaterThan(large.studentOrgCoins);
  });
  it("draws a visible coin for a tiny positive contribution", () => {
    expect(jarScale("0", "1").studentOrgCoins).toBe(1);
  });
});
