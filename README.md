# Paiflow hackathon starter

Paiflow is the money logic behind your app. This repo is the plumbing: replace `app/page.tsx` with your idea and keep the server-only typed client in `lib/paiflow.ts`. One deployment serves one business or group. Testnet only.

## Setup in five steps

1. Install **Node 22** and **pnpm 10** (`corepack enable`).
2. Run `pnpm install && pnpm dev`, then open http://localhost:3000. No `.env` is needed for demo mode.
3. Install [Freighter](https://www.freighter.app/), switch it to **Testnet**, and import your handout wallets into a dedicated testnet wallet. For initial demo setup, create a throwaway account and fund it with [Friendbot](https://laboratory.stellar.org/#account-creator?network=test).
4. Connect Freighter and pay a small amount of **XLM** in demo mode. Confirm SUCCESS and watch the live feed. To simulate another customer, switch accounts in Freighter and click **Refresh wallet** (window focus also refreshes).
5. Copy `.env.example` to `.env.local`, paste your team's `PAIFLOW_API_TOKEN` and `PAIFLOW_DEPLOYMENT_ID` from **API access** on its confirmed deployment, then restart the server. Amounts use your flow's input asset. Fill other Dev values on the linked deployment page.

Demo mode is for first setup; switch to your own token at the event. Its token is cached in server memory until two minutes before its one-hour expiry (concurrent requests share one mint). Restarting or running multiple server instances consumes more tokens. Demo minting allows only **3 tokens/hour per IP**, including shared venue Wi-Fi.

**Public demo warning:** the deployment is shared, others can see your depositing address, and deposited testnet XLM goes to a Paiflow-owned account, not back to you. Use a throwaway Friendbot wallet.

These are testnet wallets created by the organisers, who hold copies of their keys. Never send real (mainnet) funds to them or import them into a wallet you use for real money. Anyone with the key can take what's in them.

**USDC trustlines:** a fresh Stellar wallet usually cannot hold USDC until it adds a trustline to that exact asset code and issuer. A missing recipient trustline can show `TrustlineMissingError` / `The payout recipient has no trustline for {asset}. The recipient must add a trustline for {asset} before this flow can pay them.` in simulation, surfaced as 422 `VALIDATION`; the whole payment reverts. A deploy warning does not block deployment or require acknowledgement, so successful deployment does not prove recipients are ready. In the recipient's testnet wallet, use Add asset / Add trustline for code `USDC`, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, and have that wallet sign its change-trust transaction. Fund a new account with testnet XLM via Friendbot first so it exists and has reserves/fees. A trustline to another issuer's USDC will not work; native XLM needs no trustline. The handed-out wallets are provisioned with the right line, but every new recipient needs checking. Adding a trustline enables receipt, not a USDC balance: obtain testnet USDC separately, then prepare the failed payment again. Payouts checks recipient readiness before changing it; an inconclusive check also refuses mutation.

## Extending the app

- Read [llms.md](llms.md), the [staging OpenAPI spec](https://beta.app.paiflow.xyz/api/v1/openapi.json), and the [idea examples](llms.md#8-worked-examples).
- All Paiflow calls live in `lib/paiflow.ts`; no token is sent to the browser. `lib/amount.ts` converts decimal strings to integer stroop strings with bigint (7 decimals). Freighter signs; the app never holds customer keys.
- Execute preparations last **180 seconds**; payouts last **60 seconds**. SUCCESS is final, FAILED can be HTTP 200, and PENDING or transport/502 errors need **Check again** with the same signed envelope. Keep the tab open while uncertain; do not prepare a duplicate payment. API errors retain code/message, request id and Retry-After when supplied.
- The feed polls every five seconds while visible, drains cursor pages and deduplicates by eventId. It can lag; lack of an event alone does not mean payment failed.
- Per-payment recipients require a Dev-mode Pay with **Fill value via API** and your team's token. Serialise payouts; do not mix execute/direct/QR deposits or owner mutations while a payout is in progress. Wait for Retry-After on 409/429. Staging payouts/release-early are scheduled for the 6 Oct hackathon promotion; use a local Pinkraft `hackathon` before then (`PAIFLOW_BASE_URL=http://localhost:3000`, run this starter on :3001).
- **anyone who can reach this server can choose a payout recipient; add your own check before you demo publicly.** Auth is out of scope for this starter.
- `releaseEarly` is available in the server client for your authorised server handler. It authorises a relayer release without customer signing, so you must add your app's own authorisation. There is deliberately no release route or button here. Teams cannot obtain DevApiTokens; configure other dev values in Paiflow's Dev values panel.

## Checks

`pnpm typecheck`, `pnpm test`, `pnpm build`. Dependencies are limited to Next.js/React, Freighter and server-only, with TypeScript/types and Vitest for development. No database, Stellar SDK, UI library or state library. Run `pnpm audit` and scan `.next/static` for `pfk_`, `PAIFLOW_API_TOKEN` and your test token before publishing.
