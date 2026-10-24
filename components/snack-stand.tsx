"use client";

import { useEffect, useRef, useState } from "react";
import { MENU, menuItem, priceBreakdown } from "@/lib/menu";
import type { MenuItemId } from "@/lib/menu";
import type { EventItem, EventPage, Prepared, Submitted } from "@/lib/paiflow";
import { connectWallet, refreshWallet, signPrepared } from "@/lib/wallet";
import { assertOriginal } from "@/lib/transaction";
import {
  readRecovery,
  saveRecovery,
  terminal,
  assertNoConflictingRecovery,
  finishRecovery,
  readReceipt,
  receiptKey,
} from "@/lib/recovery";
import type { Recovery, PaymentReceipt } from "@/lib/recovery";
import { ContributionJars } from "@/components/contribution-jars";
import { SnackArt } from "@/components/snack-art";
import { browserRequest as request } from "@/lib/browser-api";
import {
  confirmOriginal,
  CONFIRMATION_PENDING,
  CONFIRMATION_UNRESOLVED,
} from "@/lib/confirmation";

type Config = {
  ready: boolean;
  deploymentUrl: string | null;
  mode: "prepare" | "team" | "disabled";
  message?: string;
  scope?: string;
};
type Operation = {
  signal: AbortSignal;
  valid: () => boolean;
  save: (record: Recovery) => void;
  phase: (message: string) => void;
};

const explorer = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${encodeURIComponent(hash)}`;
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-5)}`;

export function SnackStand({ config }: { config: Config }) {
  const [selected, setSelected] = useState<MenuItemId>("snack-combo");
  const [address, setAddress] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState("");
  const [feedError, setFeedError] = useState("");
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [phase, setPhase] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [pending, setPending] = useState<Recovery | null>(null);
  const [blocked, setBlocked] = useState(true);
  const active = useRef<AbortController | null>(null);
  const resumed = useRef(new Set<string>());
  const [confirming, setConfirming] = useState(false);
  const key = config.scope ? `campus-snacks-payment-v2:${config.scope}` : "";
  const scopeKey = useRef(key);
  scopeKey.current = key;
  const loadedKey = useRef<string | null>(null);
  const busy = !!phase;
  const item = menuItem(selected);
  const split = priceBreakdown(item);
  const receiptItem = receipt ? menuItem(receipt.itemId) : null;
  const checkoutEvents = receipt
    ? events.filter((event) => event.txHash === receipt.txHash)
    : [];

  useEffect(() => {
    loadedKey.current = null;
    active.current?.abort();
    active.current = null;
    resumed.current.clear();
    setBlocked(true);
    setPending(null);
    setReceipt(null);
    setPhase("");
    setConfirming(false);
    setError("");
    if (!config.ready || !config.scope) return;
    try {
      assertNoConflictingRecovery(localStorage, key);
      setReceipt(readReceipt(localStorage.getItem(receiptKey(config.scope))));
      const raw = localStorage.getItem(key);
      if (raw) {
        const stored = readRecovery(config.scope, raw);
        setPending(stored);
        setSelected(stored.itemId);
      }
      loadedKey.current = key;
      setBlocked(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Recovery storage unavailable. Preserve it before starting another payment.",
      );
    }
    return () => {
      loadedKey.current = null;
      active.current?.abort();
    };
  }, [config.ready, config.scope, key]);

  useEffect(() => {
    if (!config.ready) return;
    const refresh = () => {
      void refreshWallet()
        .then(setAddress)
        .catch(() => setAddress(""));
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [config.ready]);

  useEffect(() => {
    if (!config.ready) return;
    let cancelled = false;
    let cursor: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fetching = false;
    async function poll() {
      if (cancelled || document.hidden || fetching) return;
      fetching = true;
      let more = false;
      try {
        const page = await request<EventPage>(
          `/api/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        if (cancelled) return;
        cursor = page.nextCursor;
        more = page.hasMore;
        setEvents((previous) =>
          [
            ...new Map(
              [...previous, ...page.items].map((event) => [
                event.eventId,
                event,
              ]),
            ).values(),
          ].sort(
            (a, b) => b.ledger - a.ledger || b.eventId.localeCompare(a.eventId),
          ),
        );
        if (!page.hasMore) setFeedLoaded(true);
        setFeedError("");
      } catch (cause) {
        if (!cancelled)
          setFeedError(
            cause instanceof Error
              ? cause.message
              : "Live activity is unavailable.",
          );
      } finally {
        fetching = false;
        if (!cancelled && !document.hidden)
          timer = setTimeout(
            () => {
              void poll();
            },
            more ? 0 : 10000,
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
  }, [config.ready]);

  async function wallet(connect: boolean) {
    if (!config.ready || walletBusy || active.current) return;
    setWalletBusy(true);
    try {
      setAddress(await (connect ? connectWallet() : refreshWallet()));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet unavailable.");
    } finally {
      setWalletBusy(false);
    }
  }

  async function locked(
    action: (current: Recovery | null, op: Operation) => Promise<void>,
  ) {
    if (
      !config.ready ||
      !config.scope ||
      active.current ||
      walletBusy ||
      blocked ||
      loadedKey.current !== key
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    const valid = () =>
      !controller.signal.aborted &&
      scopeKey.current === key &&
      loadedKey.current === key;
    const op: Operation = {
      signal: controller.signal,
      valid,
      save: (record) => {
        if (!valid())
          throw new DOMException("Operation cancelled", "AbortError");
        if (record.scope !== config.scope)
          throw new Error("Payment scope mismatch.");
        saveRecovery(localStorage, key, record);
        setPending(record);
      },
      phase: (text) => {
        if (valid()) setPhase(text);
      },
    };
    setPhase("Checking payment…");
    setError("");
    try {
      if (!navigator.locks)
        throw new Error(
          "This browser needs Web Locks support for safe payment recovery.",
        );
      await navigator.locks.request(
        key,
        { ifAvailable: true },
        async (lock) => {
          if (!valid()) return;
          if (!lock)
            throw new Error(
              "Another tab is handling this payment. Return to that tab.",
            );
          assertNoConflictingRecovery(localStorage, key);
          const raw = localStorage.getItem(key);
          const current = raw ? readRecovery(config.scope!, raw) : null;
          setPending(current);
          await action(current, op);
        },
      );
    } catch (cause) {
      if (valid())
        setError(
          cause instanceof Error
            ? cause.message
            : "Payment unresolved. Preserve the original record.",
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (scopeKey.current === key && loadedKey.current === key) {
          setPhase("");
          setConfirming(false);
        }
      }
    }
  }

  async function check(current: Recovery, op: Operation) {
    if (!op.valid()) return;
    resumed.current.add(`${key}:${current.prepared.txHash}`);
    setConfirming(true);
    op.phase(CONFIRMATION_PENDING);
    const outcome = await confirmOriginal({
      txHash: current.prepared.txHash,
      signal: op.signal,
      lookup: (signal, remainingMs) =>
        request<Submitted>(
          "/api/pay",
          { action: "status", txHash: current.prepared.txHash },
          signal,
          remainingMs,
        ),
      onResult: (result) => {
        // The confirmation helper validates the original hash, network and status.
        op.save({ ...current, status: result.status });
        if (result.status === "SUCCESS" || result.status === "FAILED") {
          const finalReceipt = finishRecovery(
            localStorage,
            key,
            current,
            result,
          );
          setReceipt(finalReceipt);
          setPending(null);
          setError(
            result.status === "FAILED"
              ? result.error?.message ||
                  "Payment failed. No order was confirmed."
              : "",
          );
        } else {
          setReceipt({ ...result, itemId: current.itemId });
        }
      },
    });
    if (op.valid() && (outcome === "unresolved" || outcome === "rejected"))
      setError(CONFIRMATION_UNRESOLVED);
  }

  useEffect(() => {
    if (
      blocked ||
      busy ||
      walletBusy ||
      !pending ||
      (!pending.attempted && !terminal(pending))
    )
      return;
    const identity = `${key}:${pending.prepared.txHash}`;
    if (resumed.current.has(identity)) return;
    resumed.current.add(identity);
    void locked(async (current, op) => {
      if (current && (current.attempted || terminal(current)))
        await check(current, op);
    });
  }, [key, blocked, busy, walletBusy, pending]);

  async function signAndSubmit(current: Recovery, op: Operation) {
    if (terminal(current)) {
      await check(current, op);
      return;
    }
    let next = current;
    if (!next.signedXdr) {
      if (address !== next.address)
        throw new Error(
          "Connect the original consenting wallet to continue this payment.",
        );
      next = { ...next, signing: true };
      op.save(next);
      op.phase("Approve in Freighter…");
      const signedXdr = await signPrepared(next.prepared, next.address);
      assertOriginal(next.prepared.xdr, signedXdr, next.prepared.txHash);
      next = { ...next, signing: false, signedXdr };
      op.save(next);
    }
    assertOriginal(next.prepared.xdr, next.signedXdr!, next.prepared.txHash);
    next = { ...next, attempted: true };
    op.save(next);
    op.phase("Submitting payment…");
    try {
      const submitted = await request<Submitted>(
        "/api/pay",
        {
          signedXdr: next.signedXdr,
          preparationRequestId: next.prepared.preparationRequestId,
        },
        op.signal,
      );
      if (submitted.txHash !== next.prepared.txHash)
        throw new Error(
          "Submission hash mismatch. Check the original transaction.",
        );
    } catch {
      // A lost acknowledgement never proves failure. Only look up the saved hash.
    }
    if (op.valid()) await check(next, op);
  }

  async function pay(retry = false) {
    await locked(async (current, op) => {
      if (retry && current) {
        await signAndSubmit(current, op);
        return;
      }
      if (current)
        throw new Error(
          "Resolve the original payment before starting another order.",
        );
      if (!address) throw new Error("Connect your Freighter wallet first.");
      setReceipt(null);
      op.phase("Preparing payment…");
      const prepared = await request<Prepared>(
        "/api/pay",
        { from: address, itemId: selected },
        op.signal,
      );
      const next: Recovery = {
        version: 2,
        scope: config.scope!,
        address,
        itemId: selected,
        prepared,
      };
      op.save(next);
      await signAndSubmit(next, op);
    });
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Campus Snacks home">
          <img
            className="brand-mark"
            src="/snack-logo.svg"
            width={41}
            height={41}
            alt=""
          />{" "}
          campus snacks
        </a>
        <div className="header-meta">
          <span className="demo-label">Hackathon sample</span>
          <span className="chip" data-testid="network-chip">
            TESTNET
          </span>
        </div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow">SMALL BITES. SHARED GOOD.</p>
          <h1 id="hero-title">
            Your study break.
            <br />
            <span>Your campus, too.</span>
          </h1>
          <p className="hero-copy">
            Grab something good. With our demo flow, 10% of every snack purchase
            goes to the student org.
          </p>
          <div className="hero-note">
            <span aria-hidden="true">↗</span> One payment. Two campus causes.
          </div>
        </div>
        <div className="flow-card" aria-label="Demo payment flow">
          <p className="eyebrow">THE DEMO FLOW</p>
          <div className="flow-start">
            You buy a snack <span aria-hidden="true">↓</span>
          </div>
          <div className="flow-branches">
            <div>
              <strong>90%</strong>
              <span>Campus vendor</span>
            </div>
            <div>
              <strong>10%</strong>
              <span>Student org</span>
            </div>
          </div>
          <p>Split automatically by Paiflow</p>
        </div>
      </section>

      {!config.ready && (
        <aside className="setup-notice" role="status">
          <strong>The menu is open for a look around.</strong>{" "}
          {config.mode === "prepare"
            ? "Payments, wallet actions and live activity are paused in preparation mode."
            : config.message || "Payment setup needs attention."}
        </aside>
      )}

      <div className="shop-layout">
        <section className="menu-section" aria-labelledby="menu-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">FRESH PICKS</p>
              <h2 id="menu-title">What’s your snack?</h2>
            </div>
            <span className="muted">Testnet USDC</span>
          </div>
          <fieldset className="menu">
            <legend className="sr-only">Choose one snack</legend>
            {MENU.map((snack) => (
              <label
                key={snack.id}
                className={`snack-card ${selected === snack.id ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="snack"
                  value={snack.id}
                  checked={selected === snack.id}
                  disabled={busy || !!pending}
                  onChange={() => setSelected(snack.id)}
                />
                <div className={`snack-art art-${snack.icon}`}>
                  <span className="snack-tag">{snack.tag}</span>
                  <SnackArt kind={snack.icon} />
                </div>
                <div className="snack-info">
                  <div className="snack-title">
                    <h3>{snack.name}</h3>
                    <span className="selection-dot" aria-hidden="true" />
                  </div>
                  <p>{snack.description}</p>
                  <strong>${snack.price}</strong>
                </div>
              </label>
            ))}
          </fieldset>
          <p className="menu-footnote">
            A sample shop for the hackathon. Testnet tokens have no real-money
            value; snacks are for the demo.
          </p>
        </section>

        <section className="checkout" aria-labelledby="checkout-title">
          <p className="eyebrow">YOUR STUDY BREAK</p>
          <h2 id="checkout-title">A little good, to go.</h2>
          <div className="order-line">
            <span>{item.name}</span>
            <strong>${item.price}</strong>
          </div>
          <div className="split-preview">
            <p>Where your payment goes</p>
            <div>
              <span>
                Campus vendor <small>90%</small>
              </span>
              <strong>${split.vendor}</strong>
            </div>
            <div>
              <span>
                Student org <small>10%</small>
              </span>
              <strong>${split.studentOrg}</strong>
            </div>
          </div>
          <div className="total-line">
            <span>Total</span>
            <strong>${item.price}</strong>
          </div>
          <div className="wallet-section">
            <span className="wallet-label">YOUR WALLET</span>
            {address ? (
              <div className="wallet-connected">
                <span title={address}>{short(address)}</span>
                <button
                  className="text-button"
                  disabled={!config.ready || busy || walletBusy}
                  onClick={() => void wallet(false)}
                >
                  Refresh wallet
                </button>
              </div>
            ) : (
              <button
                className="wallet-button"
                disabled={!config.ready || busy || walletBusy}
                onClick={() => void wallet(true)}
              >
                {walletBusy ? "Connecting…" : "Connect Freighter"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            )}
          </div>
          <button
            className="buy-button"
            disabled={
              busy ||
              walletBusy ||
              !!pending ||
              !address ||
              !config.ready ||
              blocked
            }
            onClick={() => void pay()}
          >
            {phase || `Buy snack · $${item.price}`}{" "}
            <span aria-hidden="true">→</span>
          </button>
          <p className="checkout-note">
            You approve the payment in your wallet.
            <br />
            The deployed flow handles the split.
          </p>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {pending && (
            <div className="pending-note" role="status">
              <strong>
                {terminal(pending)
                  ? "Original payment resolved."
                  : "Original payment saved."}
              </strong>
              <p>
                Your browser retains this payment across reloads. Keep its
                storage until resolved. Expiry or missing history does not mean
                it failed.
              </p>
              <a
                href={explorer(pending.prepared.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                View original transaction ↗
              </a>
              <p>Status: {pending.status || "Not checked"}</p>
              <button
                disabled={!config.ready || busy || blocked}
                onClick={() =>
                  void locked(async (current, op) => {
                    if (current) await check(current, op);
                  })
                }
              >
                Check original transaction
              </button>{" "}
              {!terminal(pending) && (
                <button
                  disabled={
                    !config.ready ||
                    busy ||
                    blocked ||
                    walletBusy ||
                    (!pending.signedXdr && address !== pending.address)
                  }
                  onClick={() => void pay(true)}
                >
                  {pending.signedXdr
                    ? "Retry exact saved payment"
                    : "Sign original payment"}
                </button>
              )}
              {confirming && (
                <button onClick={() => active.current?.abort()}>
                  Stop checking
                </button>
              )}
              <p className="checkout-note">
                No goods are fulfilled by this demo. Check recipient payouts
                separately in the activity below.
              </p>
            </div>
          )}
          {receipt && (
            <div
              className={`receipt receipt-${receipt.status.toLowerCase()}`}
              role="status"
            >
              <strong>
                {receipt.status === "SUCCESS"
                  ? "Payment confirmed. Thanks for supporting campus!"
                  : receipt.status === "FAILED"
                    ? "Payment failed."
                    : "Waiting for confirmation."}
              </strong>
              <p>
                {receiptItem?.name} · ${receiptItem?.price}
              </p>
              <a
                href={explorer(receipt.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
              {receipt.status === "SUCCESS" && (
                <p className="receipt-detail">
                  {checkoutEvents.some((event) => event.kind === "PAYOUT")
                    ? "Payout activity recorded below."
                    : "Payout details will appear in the live activity."}
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="activity" aria-labelledby="activity-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">FOLLOW THE MONEY</p>
            <h2 id="activity-title">Every snack supports both.</h2>
          </div>
          <span className="live-label">
            <span aria-hidden="true" />
            {config.ready ? "Updates every 10s" : "Awaiting setup"}
          </span>
        </div>
        <p className="activity-intro">
          Watch campus contributions grow, one confirmed payment at a time.
        </p>
        {feedError && (
          <p role="alert" className="error-message">
            {feedError}
          </p>
        )}
        <ContributionJars
          events={events}
          loading={config.ready && !feedLoaded}
          ready={config.ready}
        />
        <details className="transaction-history">
          <summary>View recent transactions</summary>
          {!events.length ? (
            <div className="empty-activity">
              <span aria-hidden="true">↗</span>
              <div>
                <strong>
                  {config.ready
                    ? feedLoaded
                      ? "Be the first study break."
                      : "Loading campus activity…"
                    : "Your first payment will show up here."}
                </strong>
                <p>
                  Once confirmed, payment and payout activity appears here. The
                  feed can take a moment to catch up.
                </p>
              </div>
            </div>
          ) : (
            <ol className="event-list">
              {events.slice(0, 30).map((event) => (
                <li
                  key={event.eventId}
                  className={
                    receipt?.txHash === event.txHash ? "current-payment" : ""
                  }
                >
                  <div className="event-icon" aria-hidden="true">
                    {event.kind === "PAYOUT" ? "↗" : "↓"}
                  </div>
                  <div className="event-main">
                    <strong>
                      {event.kind === "RECEIVE"
                        ? "Customer payment"
                        : event.kind === "PAYOUT"
                          ? "Payout recorded"
                          : "Flow activity"}
                    </strong>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleString("en-PH", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <a
                    href={explorer(event.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View ${event.kind.toLowerCase()} transaction ${short(event.txHash)}`}
                  >
                    {short(event.txHash)} ↗
                  </a>
                </li>
              ))}
            </ol>
          )}
        </details>
      </section>

      <footer>
        <span>
          Made for campus.{" "}
          <a
            href="https://github.com/artisam-paiflow/paiflow-campus-snacks"
            target="_blank"
            rel="noreferrer"
          >
            Built from the Paiflow starter ↗
          </a>
        </span>
        <span>
          Powered by{" "}
          <a
            href="https://beta.app.paiflow.xyz"
            target="_blank"
            rel="noreferrer"
          >
            Paiflow
          </a>
        </span>
      </footer>
    </main>
  );
}
