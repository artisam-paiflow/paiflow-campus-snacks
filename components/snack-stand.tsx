"use client";

import { useEffect, useRef, useState } from "react";
import { MENU, menuItem, priceBreakdown } from "@/lib/menu";
import type { MenuItemId } from "@/lib/menu";
import type { EventItem, EventPage, Prepared, Submitted } from "@/lib/paiflow";
import { connectWallet, refreshWallet, signPrepared } from "@/lib/wallet";
import { ContributionJars } from "@/components/contribution-jars";
import { SnackArt } from "@/components/snack-art";

type Config = { ready: boolean; deploymentUrl: string | null };
type Pending = { signedXdr: string; itemId: MenuItemId };
type Receipt = Submitted & { itemId: MenuItemId };

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
      `HTTP ${response.status}${id ? ` · Request ID: ${id}` : ""}. If submitted, check again.`,
    );
  }
  if (!response.ok || result.error)
    throw new Error(
      `${result.error?.message || "Request failed"}${id ? ` · Request ID: ${id}` : ""}${retry ? ` · Retry after ${retry} seconds` : ""}`,
    );
  return result.data;
}

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
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const working = useRef(false);
  const busy = !!phase;
  const item = menuItem(selected);
  const split = priceBreakdown(item);
  const receiptItem = receipt ? menuItem(receipt.itemId) : null;
  const checkoutEvents = receipt
    ? events.filter((event) => event.txHash === receipt.txHash)
    : [];

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
    if (walletBusy || working.current) return;
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

  async function submit(envelope: Pending) {
    setPhase("Confirming payment…");
    const submitted = await request<Submitted>("/api/pay", {
      signedXdr: envelope.signedXdr,
    });
    setReceipt({ ...submitted, itemId: envelope.itemId });
    if (submitted.status !== "PENDING") setPending(null);
    if (submitted.status === "FAILED")
      setError(
        submitted.error?.message || "Payment failed. No order was confirmed.",
      );
  }

  async function pay(retry = false) {
    if (working.current || walletBusy) return;
    working.current = true;
    setPhase("Preparing payment…");
    setError("");
    try {
      if (retry && pending) {
        await submit(pending);
        return;
      }
      if (pending)
        throw new Error(
          "Check the signed payment before starting another order.",
        );
      if (!config.ready)
        throw new Error(
          "The snack stand needs its own Paiflow deployment first.",
        );
      if (!address) throw new Error("Connect your Freighter wallet first.");
      setReceipt(null);
      const prepared = await request<Prepared>("/api/pay", {
        from: address,
        itemId: selected,
      });
      setPhase("Approve in Freighter…");
      const signedXdr = await signPrepared(prepared, address);
      const envelope = { signedXdr, itemId: selected };
      // Retain the same envelope after PENDING, transport failures, or uncertain errors.
      setPending(envelope);
      await submit(envelope);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment failed.");
    } finally {
      working.current = false;
      setPhase("");
    }
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
          <strong>The menu is open for a look around.</strong> Payments unlock
          once the organiser connects the stand’s USDC deployment. Setup
          instructions are in the repo’s README.
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
                  disabled={busy || walletBusy}
                  onClick={() => void wallet(false)}
                >
                  Refresh wallet
                </button>
              </div>
            ) : (
              <button
                className="wallet-button"
                disabled={busy || walletBusy}
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
              busy || walletBusy || !!pending || !address || !config.ready
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
              <strong>Payment still being checked.</strong>
              <p>
                Keep this tab open. Your signed payment may already have been
                sent.
              </p>
              <button disabled={busy} onClick={() => void pay(true)}>
                {busy ? "Checking…" : "Check again"}
              </button>
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
