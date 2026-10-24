import { assertOriginal, envelopeHash } from "@/lib/transaction";
import { menuItem } from "@/lib/menu";
import type { MenuItemId } from "@/lib/menu";
import { TESTNET } from "@/lib/types";
import type { Prepared, Submitted } from "@/lib/types";
import { assertStatus } from "@/lib/confirmation";
export type PaymentReceipt = Submitted & { itemId: MenuItemId };

export const receiptKey = (scope: string) =>
  `campus-snacks-receipt-v1:${scope}`;

export function readReceipt(raw: string | null): PaymentReceipt | null {
  if (!raw) return null;
  const receipt = JSON.parse(raw) as PaymentReceipt;
  if (
    !receipt ||
    !/^[a-f0-9]{64}$/.test(receipt.txHash) ||
    receipt.network !== "testnet" ||
    !["SUCCESS", "FAILED"].includes(receipt.status)
  )
    throw new Error(
      "Saved receipt is invalid. Preserve browser storage for support.",
    );
  menuItem(receipt.itemId);
  return receipt;
}

/** Called under the checkout Web Lock after an independent original-hash lookup. */
export function finishRecovery(
  storage: Pick<Storage, "setItem" | "getItem" | "removeItem">,
  key: string,
  current: Recovery,
  result: Submitted,
): PaymentReceipt {
  assertStatus(result, current.prepared.txHash);
  if (result.status !== "SUCCESS" && result.status !== "FAILED")
    throw new Error(
      "Payment remains unresolved. Retain its original evidence.",
    );
  const receipt: PaymentReceipt = {
    txHash: result.txHash,
    network: "testnet",
    status: result.status,
    itemId: current.itemId,
    ...(result.ledger === undefined ? {} : { ledger: result.ledger }),
  };
  // Save a non-sensitive final receipt before releasing the active checkout.
  const raw = JSON.stringify(receipt);
  const archiveKey = receiptKey(current.scope);
  storage.setItem(archiveKey, raw);
  if (storage.getItem(archiveKey) !== raw)
    throw new Error(
      "Could not save the final receipt. Original payment retained.",
    );
  storage.removeItem(key);
  if (storage.getItem(key) !== null)
    throw new Error(
      "Could not release the resolved payment. Original evidence retained.",
    );
  return receipt;
}
export type Recovery = {
  version: 2;
  itemId: MenuItemId;
  scope: string;
  address: string;
  prepared: Prepared;
  signedXdr?: string;
  signing?: boolean;
  attempted?: boolean;
  status?: string;
};
export function readRecovery(scope: string, raw: string): Recovery {
  const r = JSON.parse(raw) as Recovery;
  if (
    !r ||
    r.version !== 2 ||
    r.scope !== scope ||
    typeof r.address !== "string" ||
    !/^G[A-Z2-7]{55}$/.test(r.address) ||
    !r.prepared ||
    r.prepared.network !== "testnet" ||
    r.prepared.networkPassphrase !== TESTNET ||
    !Number.isFinite(Date.parse(r.prepared.expiresAt)) ||
    !/^[a-f0-9]{64}$/.test(r.prepared.txHash) ||
    (r.signing !== undefined && typeof r.signing !== "boolean") ||
    (r.attempted !== undefined && typeof r.attempted !== "boolean") ||
    (r.status !== undefined &&
      !["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"].includes(
        r.status,
      ))
  )
    throw new Error(
      "Invalid recovery record. Retain storage for support; do not start another payment.",
    );
  menuItem(r.itemId);
  if (envelopeHash(r.prepared.xdr) !== r.prepared.txHash)
    throw new Error("Stored transaction mismatch.");
  if (r.signedXdr !== undefined)
    assertOriginal(r.prepared.xdr, r.signedXdr, r.prepared.txHash);
  return r;
}
export function saveRecovery(
  storage: Pick<Storage, "setItem" | "getItem">,
  key: string,
  r: Recovery,
) {
  const raw = JSON.stringify(r);
  readRecovery(r.scope, raw);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw)
    throw new Error("Recovery storage unavailable. Payment stopped.");
}
export function terminal(r: Recovery) {
  return r.status === "SUCCESS" || r.status === "FAILED";
}

/** Old API operations and other configured deployments must be reconciled first. */
export function assertNoConflictingRecovery(
  storage: Pick<Storage, "length" | "key" | "getItem">,
  currentKey: string,
) {
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !storage.getItem(key)) continue;
    if (key.startsWith("paiflow:operation:v1:"))
      throw new Error(
        "Older payment evidence remains in this browser. Preserve it and reconcile the original transaction before starting another payment.",
      );
    if (key.startsWith("campus-snacks-payment-v2:") && key !== currentKey) {
      const foreignScope = key.slice("campus-snacks-payment-v2:".length);
      const foreign = readRecovery(foreignScope, storage.getItem(key)!);
      if (terminal(foreign)) continue;
      throw new Error(
        "Payment evidence for another environment or deployment remains. Restore that configuration and reconcile the original record before starting another payment.",
      );
    }
  }
}
