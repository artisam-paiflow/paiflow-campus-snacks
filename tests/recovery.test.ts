import { expect, it } from "vitest";
import {
  Keypair,
  Account,
  TransactionBuilder,
  Networks,
  Operation,
  FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import {
  readRecovery,
  saveRecovery,
  terminal,
  assertNoConflictingRecovery,
  finishRecovery,
  readReceipt,
  receiptKey,
} from "@/lib/recovery";
import type { Recovery } from "@/lib/recovery";
import { assertOriginal, envelopeHash } from "@/lib/transaction";
import { fixturePrepared, fixtureAddress } from "./transaction-fixture";
const hash = envelopeHash(fixturePrepared.xdr);
const prepared = { ...fixturePrepared, txHash: hash };
const record: Recovery = {
  version: 2,
  itemId: "snack-combo",
  scope: "https://example.com/deployment",
  address: fixtureAddress,
  prepared,
};
it("restores original signed envelope after reload and rejects changed evidence", () => {
  const values = new Map<string, string>();
  const storage = {
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    getItem: (k: string) => values.get(k) ?? null,
  };
  const signed = { ...record, signedXdr: prepared.xdr, attempted: true };
  saveRecovery(storage, "key", signed);
  expect(readRecovery(record.scope, storage.getItem("key")!)).toEqual(signed);
  expect(() => readRecovery("other", storage.getItem("key")!)).toThrow();
  expect(() =>
    readRecovery(
      record.scope,
      JSON.stringify({
        ...signed,
        prepared: { ...prepared, txHash: "b".repeat(64) },
      }),
    ),
  ).toThrow();
  expect(() =>
    saveRecovery({ setItem: () => {}, getItem: () => null }, "key", record),
  ).toThrow("storage unavailable");
  expect(terminal({ ...record, status: "REJECTED" })).toBe(false);
  expect(terminal({ ...record, status: "FAILED" })).toBe(true);
});
it("checks original transaction body but allows envelope signatures", () => {
  const signed = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET);
  signed.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)));
  assertOriginal(prepared.xdr, signed.toXDR(), hash);
  const changed = new TransactionBuilder(new Account(fixtureAddress, "8"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "changed", value: "body" }))
    .setTimeout(180)
    .build();
  expect(() => assertOriginal(prepared.xdr, changed.toXDR(), hash)).toThrow(
    "changed",
  );
  if (!(signed instanceof FeeBumpTransaction)) {
    const bump = TransactionBuilder.buildFeeBumpTransaction(
      fixtureAddress,
      "100",
      signed,
      Networks.TESTNET,
    );
    expect(() => envelopeHash(bump.toXDR())).toThrow("Fee-bump");
  }
  expect(() =>
    assertOriginal(prepared.xdr, prepared.xdr, "b".repeat(64)),
  ).toThrow("changed");
});

it("blocks unresolved cross-environment records and retains older operation evidence", () => {
  for (const [key, value] of [
    ["paiflow:operation:v1:old:preparing", "retained"],
    [
      "campus-snacks-payment-v2:other",
      JSON.stringify({ ...record, scope: "other", status: "UNKNOWN" }),
    ],
  ]) {
    const storage = { length: 1, key: () => key!, getItem: () => value! };
    expect(() => assertNoConflictingRecovery(storage, "current")).toThrow();
    expect(storage.getItem()).toBe(value);
  }
});
it("rejects invalid saved menu selections and network corruption without clearing", () => {
  expect(() =>
    readRecovery(record.scope, JSON.stringify({ ...record, itemId: "fake" })),
  ).toThrow();
  expect(() =>
    readRecovery(
      record.scope,
      JSON.stringify({
        ...record,
        prepared: { ...prepared, network: "mainnet" },
      }),
    ),
  ).toThrow();
  for (const status of ["UNKNOWN", "REJECTED", "PENDING", undefined])
    expect(terminal({ ...record, status })).toBe(false);
});

it("stores and verifies a final receipt before releasing the active checkout", () => {
  const values = new Map([["active", JSON.stringify(record)]]);
  const storage = {
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      expect(readReceipt(values.get(receiptKey(record.scope))!)).toMatchObject({
        txHash: hash,
        network: "testnet",
        status: "SUCCESS",
        itemId: "snack-combo",
      });
      values.delete(key);
    },
  };
  const receipt = finishRecovery(storage, "active", record, {
    txHash: hash,
    network: "testnet",
    status: "SUCCESS",
    ledger: 123,
  });
  expect(values.has("active")).toBe(false);
  expect(readReceipt(values.get(receiptKey(record.scope))!)).toEqual(receipt);
  expect(values.get(receiptKey(record.scope))).not.toMatch(
    /signedXdr|prepared|address/,
  );
});

it("unresolved or mismatched status cannot archive or remove recovery", () => {
  const values = new Map([["active", JSON.stringify(record)]]);
  const storage = {
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  for (const status of ["UNKNOWN", "REJECTED", "PENDING"] as const)
    expect(() =>
      finishRecovery(storage, "active", record, {
        txHash: hash,
        network: "testnet",
        status,
      }),
    ).toThrow("unresolved");
  expect(() =>
    finishRecovery(storage, "active", record, {
      txHash: "b".repeat(64),
      network: "testnet",
      status: "SUCCESS",
    }),
  ).toThrow("mismatch");
  expect(values.size).toBe(1);
  expect(values.get("active")).toBe(JSON.stringify(record));
});

it("a failed receipt write or failed cleanup cannot silently release checkout", () => {
  const values = new Map([["active", JSON.stringify(record)]]);
  const storage = {
    setItem: (_key: string, _value: string) => {},
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const result = {
    txHash: hash,
    network: "testnet" as const,
    status: "FAILED" as const,
  };
  expect(() => finishRecovery(storage, "active", record, result)).toThrow(
    "save the final receipt",
  );
  expect(values.has("active")).toBe(true);
  storage.setItem = (key, value) => {
    values.set(key, value);
  };
  storage.removeItem = () => {};
  expect(() => finishRecovery(storage, "active", record, result)).toThrow(
    "release the resolved payment",
  );
  expect(values.has("active")).toBe(true);
});
