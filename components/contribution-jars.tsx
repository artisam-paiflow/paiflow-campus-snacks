"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { formatStroops } from "@/lib/amount";
import { jarScale, jarTotals } from "@/lib/jar-totals";
import type { EventItem } from "@/lib/paiflow";

type Drop = { key: number; vendor: string; studentOrg: string };

function CoinJar({
  kind,
  label,
  share,
  amount,
  coins,
  loading,
  drop,
}: {
  kind: "vendor" | "student-org";
  label: string;
  share: string;
  amount: string;
  coins: number;
  loading: boolean;
  drop: { key: number; amount: string } | null;
}) {
  const id = useId().replace(/:/g, "");
  const hasDrop = drop && BigInt(drop.amount) > 0n;
  const distance = 206 - Math.floor(Math.max(0, coins - 1) / 6) * 24;
  return (
    <figure className={`contribution-jar jar-${kind}`}>
      <div className="jar-heading">
        <h3>{label}</h3>
        <span className="jar-share">{share} of every snack</span>
      </div>
      <div className="jar-art">
        {hasDrop && (
          <span key={drop.key} className="jar-increment" aria-hidden="true">
            +${formatStroops(drop.amount)}
          </span>
        )}
        <svg viewBox="0 0 320 320" aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={`${id}-inside`}>
              <path d="M103 65H217V84C217 100 249 101 249 125V267Q249 290 225 290H95Q71 290 71 267V125C71 101 103 100 103 84Z" />
            </clipPath>
            <linearGradient id={`${id}-glass`} x1="0" x2="1">
              <stop stopColor="#edf5dc" stopOpacity=".12" />
              <stop offset=".45" stopColor="#edf5dc" stopOpacity=".02" />
              <stop offset="1" stopColor="#edf5dc" stopOpacity=".1" />
            </linearGradient>
          </defs>
          <ellipse
            cx="160"
            cy="301"
            rx="106"
            ry="10"
            fill="#080e09"
            opacity=".45"
          />
          <path
            d="M103 65H217V84C217 100 249 101 249 125V267Q249 290 225 290H95Q71 290 71 267V125C71 101 103 100 103 84Z"
            fill={`url(#${id}-glass)`}
            stroke="#7a8b75"
            strokeWidth="2"
          />
          <g clipPath={`url(#${id}-inside)`}>
            {Array.from({ length: coins }, (_, index) => {
              const row = Math.floor(index / 6);
              const x = 88 + (index % 6) * 28 + (row % 2 ? 5 : 0);
              const y = 276 - row * 24;
              return (
                <g
                  key={index}
                  className="jar-coin"
                  transform={`translate(${x} ${y}) rotate(${((index * 31) % 50) - 25})`}
                >
                  <ellipse rx="12" ry="10" />
                  <ellipse className="coin-rim" rx="8" ry="6.5" />
                  <text
                    className="coin-mark"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    $
                  </text>
                </g>
              );
            })}
          </g>
          {hasDrop && (
            <g
              key={drop.key}
              className="jar-drops"
              style={{ "--drop-distance": `${distance}px` } as CSSProperties}
            >
              {Array.from({ length: kind === "vendor" ? 5 : 2 }, (_, index) => (
                <g
                  key={index}
                  className="dropping-coin"
                  style={{ animationDelay: `${index * 130}ms` }}
                >
                  <g
                    className="jar-coin"
                    transform={`translate(${140 + (index % 3) * 18} 55)`}
                  >
                    <ellipse rx="10" ry="12" />
                    <ellipse className="coin-rim" rx="6.5" ry="8" />
                    <text
                      className="coin-mark"
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      $
                    </text>
                  </g>
                </g>
              ))}
            </g>
          )}
          <path
            d="M84 140V258Q84 273 97 276"
            stroke="#f4f3e7"
            strokeWidth="5"
            strokeLinecap="round"
            opacity=".12"
            fill="none"
          />
          <path
            d="M236 142V188"
            stroke="#f4f3e7"
            strokeWidth="3"
            strokeLinecap="round"
            opacity=".1"
          />
          <rect
            x="97"
            y="55"
            width="126"
            height="13"
            rx="5"
            fill="#354336"
            stroke="#8b9b81"
            strokeWidth="2"
          />
          <path d="M104 60H216" stroke="#c3cdb7" opacity=".45" />
        </svg>
      </div>
      <figcaption>
        <strong className="jar-total">
          {loading ? "—" : `$${formatStroops(amount)}`}
        </strong>
        <span className="jar-total-label">Total received</span>
      </figcaption>
    </figure>
  );
}

export function ContributionJars({
  events,
  loading,
  ready,
}: {
  events: readonly EventItem[];
  loading: boolean;
  ready: boolean;
}) {
  const totals = useMemo(() => jarTotals(events), [events]);
  const scale = jarScale(totals.vendorStroops, totals.studentOrgStroops);
  const seen = useRef<Set<string> | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  useEffect(() => {
    if (loading || !ready) return;
    const current = new Set(totals.payments.map((payment) => payment.eventId));
    if (seen.current === null) {
      seen.current = current; // Initial history sets levels without replaying drops.
      return;
    }
    const fresh = totals.payments.filter(
      (payment) => !seen.current?.has(payment.eventId),
    );
    seen.current = current;
    if (!fresh.length) return;
    const vendor = fresh.reduce(
      (sum, payment) => sum + BigInt(payment.vendorStroops),
      0n,
    );
    const studentOrg = fresh.reduce(
      (sum, payment) => sum + BigInt(payment.studentOrgStroops),
      0n,
    );
    setDrop((previous) => ({
      key: (previous?.key ?? 0) + 1,
      vendor: vendor.toString(),
      studentOrg: studentOrg.toString(),
    }));
  }, [totals, loading, ready]);

  const message = !ready
    ? "The jars are ready. Payments unlock after setup."
    : loading
      ? "Loading campus contributions…"
      : totals.unresolved
        ? "Waiting for matching payment and payout details. Totals include matched activity only."
        : totals.payments.length
          ? `${totals.payments.length} confirmed ${totals.payments.length === 1 ? "payment" : "payments"}. A little good, shared across campus.`
          : "The jars are empty for now. Your first snack starts something good.";
  return (
    <div className="contributions">
      <div className="contribution-jars">
        <CoinJar
          kind="vendor"
          label="Campus vendor"
          share="90%"
          amount={totals.vendorStroops}
          coins={loading ? 0 : scale.vendorCoins}
          loading={loading || !ready}
          drop={drop ? { key: drop.key, amount: drop.vendor } : null}
        />
        <CoinJar
          kind="student-org"
          label="Student org"
          share="10%"
          amount={totals.studentOrgStroops}
          coins={loading ? 0 : scale.studentOrgCoins}
          loading={loading || !ready}
          drop={drop ? { key: drop.key, amount: drop.studentOrg } : null}
        />
      </div>
      <p className="contribution-status" role="status">
        {message}
      </p>
      <p className="jar-scale">
        Shared visual scale · a full jar represents $
        {formatStroops(scale.capacityStroops)}. The scale grows with
        contributions.
      </p>
      <p className="jar-note">
        Cumulative payouts through Campus Snacks, rather than current wallet
        balances. Coins illustrate the totals.
      </p>
    </div>
  );
}
