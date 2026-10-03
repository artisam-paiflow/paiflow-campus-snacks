"use client";
import { useEffect, useRef, useState } from "react";
import { toStroops } from "@/lib/amount";
import { connectWallet, refreshWallet, signPrepared } from "@/lib/wallet";
import type { EventItem, EventPage, Prepared, Submitted } from "@/lib/paiflow";

type Feed = EventPage & { demoMode: boolean; deploymentUrl: string | null };
type Pending = { route: "pay" | "payout"; signedXdr: string };
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const id = response.headers.get("x-request-id");
  const retry = response.headers.get("Retry-After");
  let result: { data: T; error?: { code: string; message: string } };
  try {
    result = await response.json();
  } catch {
    throw new Error(
      `HTTP ${response.status}${id ? ` · x-request-id: ${id}` : ""}. If submitted, check again.`,
    );
  }
  if (!response.ok || result.error)
    throw new Error(
      `${result.error?.code || `HTTP ${response.status}`}: ${result.error?.message || "Request failed"}${id ? ` · x-request-id: ${id}` : ""}${retry ? ` · Retry-After: ${retry} seconds` : ""}`,
    );
  return result.data;
}
export default function Page() {
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("1");
  const [payoutAmount, setPayoutAmount] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [config, setConfig] = useState<Pick<
    Feed,
    "demoMode" | "deploymentUrl"
  > | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState("");
  const [feedError, setFeedError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Submitted | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const working = useRef(false);

  useEffect(() => {
    const refresh = () => {
      void refreshWallet()
        .then(setAddress)
        .catch(() => setAddress(""));
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let cursor: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fetching = false;
    async function poll() {
      if (cancelled || document.hidden || fetching) return;
      fetching = true;
      let more = false;
      try {
        const page = await request<Feed>(
          `/api/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        if (cancelled) return;
        cursor = page.nextCursor;
        more = page.hasMore;
        setConfig({
          demoMode: page.demoMode,
          deploymentUrl: page.deploymentUrl,
        });
        setEvents((previous) =>
          [
            ...new Map(
              [...previous, ...page.items].map((item) => [item.eventId, item]),
            ).values(),
          ].sort(
            (a, b) => b.ledger - a.ledger || b.eventId.localeCompare(a.eventId),
          ),
        );
        setFeedError("");
      } catch (cause) {
        if (!cancelled)
          setFeedError(
            cause instanceof Error ? cause.message : "Feed unavailable",
          );
      } finally {
        fetching = false;
        if (!cancelled && !document.hidden)
          timer = setTimeout(
            () => {
              void poll();
            },
            more ? 0 : 5000,
          );
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  async function wallet(connect: boolean) {
    try {
      setAddress(await (connect ? connectWallet() : refreshWallet()));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet unavailable");
    }
  }
  async function submit(envelope: Pending) {
    const submitted = await request<Submitted>(`/api/${envelope.route}`, {
      signedXdr: envelope.signedXdr,
    });
    setResult(submitted);
    if (submitted.status !== "PENDING") setPending(null);
    if (submitted.status === "FAILED")
      setError(
        `${submitted.error?.code || "FAILED"}: ${submitted.error?.message || "Transaction failed"}`,
      );
  }
  async function pay(route: "pay" | "payout", retry = false) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      if (retry && pending) {
        await submit(pending);
        return;
      }
      if (pending)
        throw new Error(
          "Check the existing signed transaction before starting another payment.",
        );
      if (!address) throw new Error("Connect a customer wallet first.");
      setResult(null);
      const prepared = await request<Prepared>(`/api/${route}`, {
        from: address,
        amount: toStroops(route === "pay" ? amount : payoutAmount),
        ...(route === "payout"
          ? { recipient, ...(nodeId ? { nodeId } : {}) }
          : {}),
      });
      const signedXdr = await signPrepared(prepared, address);
      const envelope = { route, signedXdr };
      // Keep the exact signed envelope after PENDING or transport/502 errors.
      setPending(envelope);
      await submit(envelope);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment failed");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <main>
      <header>
        <h1>Your idea, powered by Paiflow</h1>
        <span className="chip" data-testid="network-chip">
          TESTNET
        </span>
      </header>
      <p>
        Replace this checkout with your app. Your deployed flow supplies the
        money logic.
      </p>
      {config?.demoMode && (
        <aside>
          Demo mode — shared deployment. Use a throwaway Friendbot wallet:
          others can see your depositing address, and testnet XLM goes to
          Paiflow, not back to you.
        </aside>
      )}
      <section aria-label="Customer wallet">
        <h2>Customer wallet</h2>
        <p className="address">{address || "No wallet connected"}</p>
        <button disabled={busy} onClick={() => void wallet(true)}>
          Connect Freighter
        </button>{" "}
        <button disabled={busy} onClick={() => void wallet(false)}>
          Refresh wallet
        </button>
        <p>
          Switch customer accounts in Freighter, then refresh. The selected
          wallet signs its own payment.
        </p>
      </section>
      <section>
        <h2>Pay</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void pay("pay");
          }}
        >
          <label>
            Amount (flow input asset; XLM in demo mode)
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <button disabled={busy || !!pending || !address}>
            {busy ? "Working…" : "Pay"}
          </button>
        </form>
      </section>
      {config && !config.demoMode && (
        <details>
          <summary>
            Per-payment recipient (Dev mode flows with Pay → Fill value via API)
          </summary>
          <p>
            Payouts must run one at a time. Do not mix them with Pay, QR
            deposits or owner changes while a payout is in progress.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void pay("payout");
            }}
          >
            <label>
              Recipient G-address
              <input
                required
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              />
            </label>
            <label>
              Amount (flow input asset)
              <input
                required
                inputMode="decimal"
                value={payoutAmount}
                onChange={(event) => setPayoutAmount(event.target.value)}
              />
            </label>
            <label>
              Pay node id (optional)
              <input
                value={nodeId}
                onChange={(event) => setNodeId(event.target.value)}
              />
            </label>
            <button disabled={busy || !!pending || !address}>
              Prepare, sign and pay recipient
            </button>
          </form>
          {config.deploymentUrl && (
            <p>
              <a href={config.deploymentUrl} target="_blank" rel="noreferrer">
                Fill other dev values
              </a>
            </p>
          )}
        </details>
      )}
      {result && (
        <p role="status">
          {result.status} ·{" "}
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${result.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            {result.txHash}
          </a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {pending && (
        <p>
          The signed payment may still execute. Keep this tab open.{" "}
          <button disabled={busy} onClick={() => void pay(pending.route, true)}>
            Check again
          </button>
        </p>
      )}
      <section>
        <h2>Live feed</h2>
        {feedError && <p role="alert">{feedError}</p>}
        {!events.length && (
          <p>
            Waiting for events. Collection can lag; check submission status
            before paying again.
          </p>
        )}
        <ol>
          {events.map((item) => (
            <li key={item.eventId}>
              <strong>
                {item.kind}
                {item.topic ? ` · ${item.topic}` : ""}
              </strong>{" "}
              · <time dateTime={item.occurredAt}>{item.occurredAt}</time>
              <p>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.txHash}
                </a>
              </p>
              <pre>{JSON.stringify(item.data, null, 2)}</pre>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
