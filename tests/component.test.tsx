import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SnackStand } from "@/components/snack-stand";
import { fixtureAddress, fixturePrepared } from "./transaction-fixture";
import { connectWallet, signPrepared, refreshWallet } from "@/lib/wallet";
import { envelopeHash } from "@/lib/transaction";
import { receiptKey } from "@/lib/recovery";
import type { Submitted } from "@/lib/types";
vi.mock("@/lib/wallet", () => ({
  connectWallet: vi.fn(),
  signPrepared: vi.fn(),
  refreshWallet: vi.fn(),
}));
const scope =
  "https://beta.app.paiflow.xyz/12345678-1234-1234-1234-123456789abc";
const key = `campus-snacks-payment-v2:${scope}`;
const config = {
  ready: true,
  mode: "team" as const,
  scope,
  deploymentUrl: scope,
};
const stored = {
  version: 2,
  itemId: "snack-combo",
  scope,
  address: fixtureAddress,
  prepared: { ...fixturePrepared, txHash: envelopeHash(fixturePrepared.xdr) },
  signedXdr: fixturePrepared.xdr,
  attempted: true,
};
const status = (value: Submitted["status"]) =>
  Response.json({
    data: {
      txHash: stored.prepared.txHash,
      network: "testnet",
      status: value,
      ledger: 123,
    },
  });
let renderer: ReactTestRenderer | undefined;
let values: Map<string, string>;
let lockAvailable = true;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  values = new Map();
  lockAvailable = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn(
        async (
          _key: string,
          _options: unknown,
          callback: (lock: object | null) => unknown,
        ) => callback(lockAvailable ? {} : null),
      ),
    },
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", {
    hidden: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => status("REJECTED")),
  );
  vi.mocked(refreshWallet).mockResolvedValue("");
  vi.mocked(connectWallet).mockResolvedValue(fixtureAddress);
  vi.mocked(signPrepared).mockResolvedValue(fixturePrepared.xdr);
});
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(<SnackStand config={config} />);
  });
}
function buttons() {
  return renderer!.root.findAllByType("button");
}
function button(label: string) {
  return buttons().find((b) => b.children.join("").includes(label))!;
}
async function click(label: string) {
  expect(button(label)).toBeDefined();
  expect(button(label).props.disabled).not.toBe(true);
  await act(async () => {
    button(label).props.onClick();
  });
}
const body = (options?: RequestInit) => JSON.parse(options!.body as string);
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function hasAcknowledgement() {
  return buttons().some((b) => b.children.join("").includes("Acknowledge"));
}

it("automatically checks after signing and submission, then releases checkout without acknowledgement", async () => {
  let lookups = 0;
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const input = body(options);
    if (input.from) return Response.json({ data: stored.prepared });
    const saved = JSON.parse(values.get(key)!);
    expect(saved.signedXdr).toBe(stored.signedXdr);
    expect(saved.attempted).toBe(true);
    if (input.signedXdr) return status("PENDING");
    expect(input).toEqual({ action: "status", txHash: stored.prepared.txHash });
    return status(++lookups === 1 ? "PENDING" : "SUCCESS");
  });
  vi.mocked(signPrepared).mockImplementation(async () => {
    const saved = JSON.parse(values.get(key)!);
    expect(saved.prepared).toEqual(stored.prepared);
    expect(saved.signing).toBe(true);
    expect(saved.signedXdr).toBeUndefined();
    return stored.signedXdr;
  });
  await mount();
  await click("Connect Freighter");
  await click("Buy snack");
  expect(button("Stop checking")).toBeDefined();
  expect(values.has(key)).toBe(true);
  await advance(1000);
  expect(values.has(key)).toBe(false);
  expect(JSON.parse(values.get(receiptKey(scope))!)).toMatchObject({
    status: "SUCCESS",
    itemId: "snack-combo",
    txHash: stored.prepared.txHash,
  });
  expect(button("Buy snack").props.disabled).toBe(false);
  expect(hasAcknowledgement()).toBe(false);
  expect(signPrepared).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(4);
  await advance(60000);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("a lost submission response starts original-hash checks without resubmitting", async () => {
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const input = body(options);
    if (input.from) return Response.json({ data: stored.prepared });
    if (input.signedXdr) throw new TypeError("Lost submission acknowledgement");
    expect(input.txHash).toBe(stored.prepared.txHash);
    return status("SUCCESS");
  });
  await mount();
  await click("Connect Freighter");
  await click("Buy snack");
  expect(values.has(key)).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("submission SUCCESS alone cannot release checkout before an independent final status", async () => {
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const input = body(options);
    return input.from
      ? Response.json({ data: stored.prepared })
      : status(input.signedXdr ? "SUCCESS" : "UNKNOWN");
  });
  await mount();
  await click("Connect Freighter");
  await click("Buy snack");
  await advance(30000);
  expect(values.has(key)).toBe(true);
  expect(values.has(receiptKey(scope))).toBe(false);
  expect(button("Buy snack").props.disabled).toBe(true);
});

it.each(["SUCCESS", "FAILED"] as const)(
  "reload automatically checks %s and retains its receipt without signing or sending",
  async (final) => {
    values.set(key, JSON.stringify(stored));
    vi.mocked(refreshWallet).mockResolvedValue(fixtureAddress);
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      expect(body(options)).toEqual({
        action: "status",
        txHash: stored.prepared.txHash,
      });
      return status(final);
    });
    await mount();
    expect(values.has(key)).toBe(false);
    expect(button("Buy snack").props.disabled).toBe(false);
    expect(JSON.parse(values.get(receiptKey(scope))!).status).toBe(final);
    expect(hasAcknowledgement()).toBe(false);
    expect(signPrepared).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => renderer!.unmount());
    await mount();
    expect(
      renderer!.root.findAllByProps({
        className: `receipt receipt-${final.toLowerCase()}`,
      }),
    ).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it("restored terminal status is rechecked rather than trusted to clear payment", async () => {
  values.set(key, JSON.stringify({ ...stored, status: "SUCCESS" }));
  vi.mocked(fetch).mockResolvedValue(status("UNKNOWN"));
  await mount();
  await advance(30000);
  expect(values.has(key)).toBe(true);
  expect(values.has(receiptKey(scope))).toBe(false);
  expect(button("Buy snack").props.disabled).toBe(true);
});

it("UNKNOWN is bounded to six checks, retains evidence and resumes only on deliberate checking", async () => {
  values.set(key, JSON.stringify(stored));
  vi.mocked(fetch).mockResolvedValue(status("UNKNOWN"));
  await mount();
  await advance(60000);
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(JSON.parse(values.get(key)!).status).toBe("UNKNOWN");
  expect(button("Buy snack").props.disabled).toBe(true);
  vi.mocked(fetch).mockResolvedValue(status("SUCCESS"));
  await click("Check original transaction");
  expect(values.has(key)).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(7);
});

it("stopping automatic checks retains the unresolved payment and ignores late success", async () => {
  values.set(key, JSON.stringify(stored));
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await mount();
  await click("Stop checking");
  await act(async () => {
    resolve(status("SUCCESS"));
  });
  await advance(60000);
  expect(values.get(key)).toBe(JSON.stringify(stored));
  expect(button("Buy snack").props.disabled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("another tab owning the Web Lock prevents automatic checks and preserves evidence", async () => {
  values.set(key, JSON.stringify(stored));
  lockAvailable = false;
  await mount();
  expect(fetch).not.toHaveBeenCalled();
  expect(values.get(key)).toBe(JSON.stringify(stored));
  expect(button("Buy snack").props.disabled).toBe(true);
});

it("manual exact retry preserves the original signed body before any send", async () => {
  values.set(key, JSON.stringify(stored));
  await mount();
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const input = body(options);
    const saved = JSON.parse(values.get(key)!);
    expect(saved.signedXdr).toBe(stored.signedXdr);
    if (input.signedXdr) {
      expect(input.signedXdr).toBe(stored.signedXdr);
      expect(saved.attempted).toBe(true);
      throw new Error("network lost");
    }
    return status("REJECTED");
  });
  await click("Retry exact saved payment");
  expect(values.has(key)).toBe(true);
  expect(button("Buy snack").props.disabled).toBe(true);
  expect(hasAcknowledgement()).toBe(false);
});

it("unreadable storage blocks all new payments instead of discarding evidence", async () => {
  values.set(key, "corrupt recovery");
  await mount();
  expect(button("Buy snack").props.disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  expect(values.get(key)).toBe("corrupt recovery");
});

it("storage failure before exact retry stops submission", async () => {
  values.set(key, JSON.stringify(stored));
  await mount();
  const calls = vi.mocked(fetch).mock.calls.length;
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await click("Retry exact saved payment");
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(values.has(key)).toBe(true);
});

it("receipt storage failure keeps checkout blocked after final status", async () => {
  values.set(key, JSON.stringify(stored));
  vi.mocked(fetch).mockResolvedValue(status("SUCCESS"));
  vi.spyOn(localStorage, "setItem").mockImplementation((k, v) => {
    if (k === receiptKey(scope)) throw new Error("quota");
    values.set(k, v);
  });
  await mount();
  expect(values.has(key)).toBe(true);
  expect(button("Buy snack").props.disabled).toBe(true);
  expect(values.has(receiptKey(scope))).toBe(false);
});

it.each([
  { txHash: "b".repeat(64), network: "testnet", status: "SUCCESS" },
  { txHash: stored.prepared.txHash, network: "mainnet", status: "SUCCESS" },
  { txHash: stored.prepared.txHash, network: "testnet", status: "NOT_FOUND" },
])("mismatched status evidence never releases checkout: %j", async (data) => {
  values.set(key, JSON.stringify(stored));
  vi.mocked(fetch).mockResolvedValue(Response.json({ data }));
  await mount();
  expect(values.get(key)).toBe(JSON.stringify(stored));
  expect(values.has(receiptKey(scope))).toBe(false);
});

it("configuration changes cancel stale original-hash lookups", async () => {
  values.set(key, JSON.stringify(stored));
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await mount();
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
  await act(async () => {
    renderer!.update(
      <SnackStand
        config={{ ready: false, mode: "prepare", deploymentUrl: null }}
      />,
    );
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(status("SUCCESS"));
  });
  expect(values.get(key)).toBe(JSON.stringify(stored));
  expect(values.has(receiptKey(scope))).toBe(false);
  expect(button("Buy snack").props.disabled).toBe(true);
});

it("unsigned preparations never trigger an automatic wallet or submission request", async () => {
  values.set(
    key,
    JSON.stringify({ ...stored, attempted: false, signedXdr: undefined }),
  );
  await mount();
  await advance(60000);
  expect(fetch).not.toHaveBeenCalled();
  expect(signPrepared).not.toHaveBeenCalled();
  expect(button("Buy snack").props.disabled).toBe(true);
});

it("unmount aborts an in-flight status lookup and ignores its late success", async () => {
  values.set(key, JSON.stringify(stored));
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await mount();
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
  await act(async () => {
    renderer!.unmount();
  });
  renderer = undefined;
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(status("SUCCESS"));
  });
  await advance(60000);
  expect(values.get(key)).toBe(JSON.stringify(stored));
  expect(values.has(receiptKey(scope))).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("wallet cancellation preserves preparation and never starts submission or automatic checking", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ data: stored.prepared }));
  vi.mocked(signPrepared).mockRejectedValue(
    new Error("Transaction cancelled in your wallet."),
  );
  await mount();
  await click("Connect Freighter");
  await click("Buy snack");
  await advance(60000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(values.get(key)!)).toMatchObject({
    signing: true,
    prepared: stored.prepared,
  });
  expect(JSON.parse(values.get(key)!).attempted).toBeUndefined();
  expect(values.has(receiptKey(scope))).toBe(false);
  expect(button("Buy snack").props.disabled).toBe(true);
});
