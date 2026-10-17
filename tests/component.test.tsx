import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SnackStand } from "@/components/snack-stand";
import { fixtureAddress, fixturePrepared } from "./transaction-fixture";
import { connectWallet, signPrepared, refreshWallet } from "@/lib/wallet";
import { envelopeHash } from "@/lib/transaction";
vi.mock("@/lib/wallet", () => ({
  connectWallet: vi.fn(),
  signPrepared: vi.fn(),
  refreshWallet: vi.fn().mockResolvedValue(""),
}));
const scope =
  "https://beta.app.paiflow.xyz/12345678-1234-1234-1234-123456789abc";
const key = `campus-snacks-payment-v2:${scope}`;
const stored = {
  version: 2,
  itemId: "snack-combo",
  scope,
  address: fixtureAddress,
  prepared: { ...fixturePrepared, txHash: envelopeHash(fixturePrepared.xdr) },
  signedXdr: fixturePrepared.xdr,
  attempted: true,
};
let renderer: ReactTestRenderer;
let values: Map<string, string>;
let lockAvailable = true;
beforeEach(() => {
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
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(refreshWallet).mockResolvedValue("");
  vi.mocked(connectWallet).mockResolvedValue(fixtureAddress);
  vi.mocked(signPrepared).mockResolvedValue(fixturePrepared.xdr);
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});
async function mount() {
  await act(() => {
    renderer = create(
      <SnackStand
        config={{ ready: true, mode: "team", scope, deploymentUrl: scope }}
      />,
    );
  });
}
function button(label: string) {
  return renderer.root
    .findAllByType("button")
    .find((b) => b.children.join("").includes(label))!;
}
it("reload restores signed envelope and persists it before uncertain exact retry", async () => {
  values.set(key, JSON.stringify(stored));
  await mount();
  expect(button("Buy snack").props.disabled).toBe(true);
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const persisted = JSON.parse(values.get(key)!);
    expect(persisted.signedXdr).toBe(stored.signedXdr);
    expect(persisted.attempted).toBe(true);
    expect(JSON.parse(options!.body as string).signedXdr).toBe(
      stored.signedXdr,
    );
    throw new Error("network lost");
  });
  await act(() => button("Retry exact saved payment").props.onClick());
  expect(JSON.parse(values.get(key)!).signedXdr).toBe(stored.signedXdr);
  expect(button("Buy snack").props.disabled).toBe(true);
  expect(
    renderer.root
      .findAllByType("button")
      .some((b) => b.children.join("").includes("Acknowledge result")),
  ).toBe(false);
});
it("another tab owning Web Lock prevents submit and preserves evidence", async () => {
  values.set(key, JSON.stringify(stored));
  await mount();
  lockAvailable = false;
  await act(() => button("Retry exact saved payment").props.onClick());
  expect(fetch).not.toHaveBeenCalled();
  expect(values.get(key)).toBe(JSON.stringify(stored));
});
it("unreadable storage blocks all new payments instead of discarding evidence", async () => {
  values.set(key, "corrupt recovery");
  await mount();
  expect(button("Buy snack").props.disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  expect(values.get(key)).toBe("corrupt recovery");
});
it("storage write failure prevents submission", async () => {
  values.set(key, JSON.stringify(stored));
  await mount();
  vi.stubGlobal("localStorage", {
    length: 1,
    key: () => key,
    getItem: () => JSON.stringify(stored),
    setItem: () => {
      throw new Error("quota");
    },
  });
  await act(() => button("Retry exact saved payment").props.onClick());
  expect(fetch).not.toHaveBeenCalled();
});
it("UNKNOWN after reload preserves record and never permits clearing", async () => {
  values.set(key, JSON.stringify(stored));
  await mount();
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      data: {
        txHash: stored.prepared.txHash,
        network: "testnet",
        status: "UNKNOWN",
      },
    }),
  );
  await act(() => button("Check original transaction").props.onClick());
  expect(JSON.parse(values.get(key)!).status).toBe("UNKNOWN");
  expect(
    renderer.root
      .findAllByType("button")
      .some((b) => b.children.join("").includes("Acknowledge result")),
  ).toBe(false);
});

it("persists original preparation before signing, then signed body before first submit", async () => {
  await mount();
  await act(() => button("Connect Freighter").props.onClick());
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    if (body.from) return Response.json({ data: stored.prepared });
    const saved = JSON.parse(values.get(key)!);
    expect(saved.signing).toBe(false);
    expect(saved.attempted).toBe(true);
    expect(saved.signedXdr).toBe(stored.signedXdr);
    throw new Error("Response lost after submission");
  });
  vi.mocked(signPrepared).mockImplementation(async () => {
    const saved = JSON.parse(values.get(key)!);
    expect(saved.prepared).toEqual(stored.prepared);
    expect(saved.signing).toBe(true);
    expect(saved.signedXdr).toBeUndefined();
    return stored.signedXdr;
  });
  await act(() => button("Buy snack").props.onClick());
  expect(signPrepared).toHaveBeenCalled();
  expect(JSON.parse(values.get(key)!).attempted).toBe(true);
  expect(button("Buy snack").props.disabled).toBe(true);
});
it("requires original independent final status before enabling another order", async () => {
  values.set(key, JSON.stringify(stored));
  await mount();
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      data: {
        txHash: stored.prepared.txHash,
        status: "SUCCESS",
        network: "testnet",
      },
    }),
  );
  await act(() => button("Check original transaction").props.onClick());
  expect(values.has(key)).toBe(true);
  await act(() =>
    button("Acknowledge result and start another order").props.onClick(),
  );
  expect(values.has(key)).toBe(false);
});
