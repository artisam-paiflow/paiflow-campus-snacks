import { fromStroops } from "@/lib/amount";
import type { EventItem } from "@/lib/paiflow";

export type ConfirmedSplit = {
  eventId: string;
  txHash: string;
  vendorStroops: string;
  studentOrgStroops: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function depositAmount(event: EventItem): bigint | null {
  if (
    event.kind !== "RECEIVE" ||
    event.topic !== "deposit" ||
    !record(event.data)
  )
    return null;
  const { asset, amount } = event.data;
  if (asset !== "USDC" || typeof amount !== "string") return null;
  try {
    fromStroops(amount); // Same integer/i128 boundary as checkout.
    return BigInt(amount) > 0n ? BigInt(amount) : null;
  } catch {
    return null;
  }
}

function splitRecipients(event: EventItem): [number, number] | null {
  if (
    event.kind !== "PAYOUT" ||
    event.topic !== "payout" ||
    !record(event.data)
  )
    return null;
  const { recipients } = event.data;
  if (!Array.isArray(recipients) || recipients.length !== 2) return null;
  const [first, last]: unknown[] = recipients;
  if (!record(first) || !record(last)) return null;
  for (const recipient of [first, last]) {
    if (
      typeof recipient.address !== "string" ||
      !/^G[A-Z2-7]{55}$/.test(recipient.address) ||
      recipient.amount !== "0" ||
      recipient.is_cash_out !== false
    )
      return null;
  }
  if (first.address === last.address) return null;
  if (first.bps === 9000 && last.bps === 1000) return [9000, 1000];
  if (first.bps === 1000 && last.bps === 9000) return [1000, 9000];
  return null;
}

// Split emits its configured roster (amount="0" for percentage recipients),
// not transferred amounts. Pair its payout with the deposit in the same tx.
// Match do_split: floor the first share, give the last recipient the remainder.
export function jarTotals(events: readonly EventItem[]) {
  const groups = new Map<string, EventItem[]>();
  for (const event of new Map(
    events.map((item) => [item.eventId, item]),
  ).values()) {
    const group = groups.get(event.txHash) ?? [];
    group.push(event);
    groups.set(event.txHash, group);
  }
  const payments: ConfirmedSplit[] = [];
  let unresolved = 0;
  let vendor = 0n;
  let studentOrg = 0n;
  for (const group of groups.values()) {
    const deposits = group.filter((event) => event.kind === "RECEIVE");
    const payouts = group.filter((event) => event.kind === "PAYOUT");
    if (!deposits.length && !payouts.length) continue;
    const deposit = deposits[0];
    const payout = payouts[0];
    // Ambiguous multi-deposit/multi-payout transactions must never inflate totals.
    const amount =
      deposits.length === 1 && deposit ? depositAmount(deposit) : null;
    const shares =
      payouts.length === 1 && payout ? splitRecipients(payout) : null;
    if (amount === null || !shares || !payout) {
      unresolved++;
      continue;
    }
    const product = amount * BigInt(shares[0]);
    // Mirror the contract's checked_mul(...).unwrap_or(0) at the i128 boundary.
    const first = product <= (1n << 127n) - 1n ? product / 10000n : 0n;
    const vendorShare = shares[0] === 9000 ? first : amount - first;
    const orgShare = amount - vendorShare;
    vendor += vendorShare;
    studentOrg += orgShare;
    payments.push({
      eventId: payout.eventId,
      txHash: payout.txHash,
      vendorStroops: vendorShare.toString(),
      studentOrgStroops: orgShare.toString(),
    });
  }
  return {
    payments,
    vendorStroops: vendor.toString(),
    studentOrgStroops: studentOrg.toString(),
    unresolved,
  };
}

// Both jars always use the same capacity. Expand it as contributions grow;
// only the bounded drawing ratio becomes a number, never a monetary amount.
export function jarScale(vendorStroops: string, studentOrgStroops: string) {
  const vendor = BigInt(vendorStroops);
  const org = BigInt(studentOrgStroops);
  let capacity = 100_000_000n; // Start at 10 USDC per jar.
  while (capacity < vendor || capacity < org) capacity *= 2n;
  const coins = (amount: bigint) =>
    Number((amount * 48n + capacity - 1n) / capacity);
  return {
    capacityStroops: capacity.toString(),
    vendorCoins: coins(vendor),
    studentOrgCoins: coins(org),
  };
}
