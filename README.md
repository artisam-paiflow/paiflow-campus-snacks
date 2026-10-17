# Campus Snacks

A small hackathon sample for a campus snack shop, showing how an app can use Paiflow for its payment rules.

Pick one of three snacks, connect Freighter, and pay testnet USDC. The sample represents one branch of a snack shop. One Paiflow deployment serves all customers of that branch and routes **90% to the campus vendor and 10% to the student organisation**. The app shows a split preview, a confirmed-payment receipt, and two live coin jars showing cumulative contributions to the vendor and student organisation.

Live demo: [campus-snacks.up.railway.app](https://campus-snacks.up.railway.app). Prices and jar totals use `$` for testnet USDC.

This is a sample shop: no real snacks, real-money prices, fulfilment, or persistent order database. The server uses the published `@paiflow/sdk@0.2.0` beta, based on the [SDK payment starter](https://github.com/artisam-paiflow/paiflow-hackathon-starter). Nothing is marked confirmed until the original transaction status returns `SUCCESS`. The browser saves the original preparation and signed envelope for recovery across reloads; `PENDING`, `UNKNOWN`, rejection and uncertain responses never permit a replacement payment.

![Campus Snacks menu and checkout](docs/preview.png)

The unconfigured sample lets you browse the menu; payments unlock after setup.

## Choose the right resource

| Resource                                                                                                 | Use it for                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Paiflow Guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/hackathon/paiflow-guide.md) | Wallet setup, building and deploying a flow, then integrating an app with the SDK.                      |
| [SDK README](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md)             | Typed Node integration, examples, errors and transaction recovery for the published beta.               |
| [HTTP API README](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md)            | Endpoint schemas, signing, errors, recovery and advanced workflows; includes OpenAPI and Postman links. |
| [AI developer context](llms.md)                                                                          | Product constraints, API details and worked examples for your AI assistant.                             |

Distribute only the event-specific primer and the Paiflow Guide as PDFs. The guide is event-neutral; follow your primer for event rules, registration, submission and support. Detailed SDK/API references remain on GitHub.

## Hackathon timeline

Follow your event's participant brief and organisers for onboarding, preparation permissions, credentials, integration timing and submission rules. This repository does not set those rules.

Use preparation mode to build and customise non-payment screens. Prepare dedicated customer and recipient testnet wallets and obtain funding when your event permits it; wallet support or fallback wallets depend on the organisers.

Organiser-provided fallback wallets are testnet-only; organisers retain copies of their keys. Never use them for real funds or import their keys into a wallet you use for real money. Never put wallet secret keys in the app.

## Run locally

Requires **Node >=22.22.2 <23** and **pnpm 10.4.1**. Use this sample's setup below for its USDC deployment; the [SDK payment example](https://github.com/artisam-paiflow/paiflow-hackathon-starter) is the minimal native-XLM integration reference.

Payment requests must come from this application's own browser origin. Railway
uses its server-provided `RAILWAY_PUBLIC_DOMAIN` automatically. For a custom domain
or another reverse proxy, set server-only `APP_ORIGIN` to the public origin (for
example, `https://snacks.example.com`) and restart. This is your snack app's origin,
separate from the upstream `PAIFLOW_BASE_URL`. Local development defaults to the
request origin; forwarded headers never choose the trusted origin.

```bash
git clone https://github.com/artisam-paiflow/paiflow-campus-snacks.git
cd paiflow-campus-snacks
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000. The app defaults to preparation mode, including when credentials are present. Wallet actions, payments and event polling stay disabled until you explicitly select team mode and configure the stand below. Direct payment/event requests return HTTP 403 `PREPARATION_MODE`; the server makes no upstream calls. Configure this stand's own USDC deployment before making payments.

## Set up the stand in Paiflow

1. Sign into [Paiflow testnet](https://beta.app.paiflow.xyz) with your team account.
2. Build **On Receive (USDC) → Split (USDC)**, with percentage recipients in this order:

   | Recipient                           | Share | Basis points |
   | ----------------------------------- | ----- | ------------ |
   | Campus vendor testnet wallet        | 90%   | 9000         |
   | Student organisation testnet wallet | 10%   | 1000         |

   Use two distinct, funded testnet public `G…` addresses. Replace the builder's default recipients. Leave Dev mode off; do not use fixed Split amounts or a Swap. Leave the receive minimum unset.

3. Confirm both recipients have a trustline for the exact testnet USDC asset: code `USDC`, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. A fresh account needs testnet XLM for reserves and fees before it can add the trustline. A trustline to another USDC issuer will not work.
4. Connect the deploying wallet, sign deployment, and wait for **CONFIRMED** and an active deployment. Open **Account → Developer API**, create a **Read and operate** token, explicitly select this owned deployment, and copy the token before leaving. A deployment-bound token from the deployment’s **API access** tab also works.
5. Set these values in `.env.local` (or your app host's server environment), then restart:

   ```dotenv
   PAIFLOW_MODE=team
   PAIFLOW_BASE_URL=https://beta.app.paiflow.xyz
   PAIFLOW_API_TOKEN=<your developer or deployment API token>
   PAIFLOW_DEPLOYMENT_ID=<your confirmed deployment UUID>
   ```

   Set team mode only when your event permits integration. Missing or invalid credentials disable integration with a clear configuration error; `demo` is unsupported and never selected by an empty token. Keep the guards when customising the app. Confirm any pending signed payment before changing modes.

   Keep the token on the server. Never use `NEXT_PUBLIC_`, commit `.env.local`, or paste wallet secrets into the app. One deployment serves all this stand's customers.

6. Install [Freighter](https://www.freighter.app/), select **Testnet**, and connect a funded customer wallet with the same USDC trustline and a testnet USDC balance. Adding a trustline does not provide a balance. Check the exact trustline and required balances in every wallet, including any organiser-provided fallback wallet. Friendbot supplies XLM, not USDC.

**Testnet USDC funding:** after funding the wallet with XLM and adding the exact USDC trustline, open [Circle's testnet faucet](https://faucet.circle.com/), select **USDC** and **Stellar Testnet**, and enter the customer's public wallet address (`G…`). Confirm the USDC balance before testing payments. Repeat for any wallet that will fund a flow, and choose test amounts that fit the available balance. Friendbot supplies XLM, not USDC.

The app's 90/10 display is a preview of this required flow setup. SDK capabilities check that the configured deployment accepts testnet USDC deposits and supports execution. The SDK uses exactly `PAIFLOW_DEPLOYMENT_ID`, even when a `pfd_` token can access multiple deployments. Capabilities do not prove a 90/10 graph or the intended recipients: configuring a different deployment changes where money actually goes. Review the deployed recipients and shares, then rehearse the payout. API simulation checks account and trustline readiness before signing.

## Rehearse the demo

1. Choose **The study-break combo**: total 3.5 USDC; vendor preview 3.15; student org preview 0.35.
2. Connect the customer wallet and choose **Buy snack**. Approve the transaction in Freighter.
3. Wait for **Payment confirmed**, then follow **View transaction**. Confirm the vendor and student organisation payouts using the deployment's contract addresses and the on-chain transaction.
4. Watch the **Campus Vendor** and **Student Org** coin jars fill after matching payment and payout events arrive. Each jar shows cumulative USDC received through this deployment, rather than its wallet balance. Both use a shared visual scale that expands as contributions grow; coins illustrate the totals. Expand **View recent transactions** for explorer links. The feed can lag; absence of an event is not proof that a transaction failed.
5. To demonstrate a second customer, switch accounts in Freighter and select **Refresh wallet**.

The percentage Split event contains configured shares, not transferred amounts. Jar totals pair one USDC deposit with one 90/10 Split payout in the same transaction and follow contract rounding (the last recipient receives the remainder). Events are deduplicated by `eventId`. Initial history fills the jars without replaying animations; only newly matched payouts trigger coin drops. Unmatched or unsupported activity stays visible in the transaction history and is excluded from the totals. Reduced-motion preferences disable the drops.

The app saves the original preparation before asking Freighter to sign, checks that the signed transaction body has the same hash, then saves the signed envelope before submission. It forwards the preparation history ID and checks the original transaction status independently after submitting. Reloading restores the original snack, payer, preparation and signed envelope. Browser storage is scoped to the Paiflow environment and deployment; Web Locks prevent two tabs from handling the same checkout concurrently.

For a pending or uncertain payment, use **Check original transaction** to query its original hash. **Retry exact saved payment** resubmits only the saved envelope. If signing was cancelled or interrupted, **Sign original payment** asks the original wallet to sign the saved preparation; it does not prepare another transaction. A wallet change, expired preparation, `UNKNOWN`, `REJECTED`, missing history or network error keeps the record unresolved. Check the original transaction in the deployment dashboard/explorer and contact support if it cannot be reconciled; local expiry alone does not establish finality. HTTP 200 with `FAILED` is still a failed transaction.

Only a final status of `SUCCESS` or `FAILED` enables **Acknowledge result and start another order**. Keep this browser's storage until reconciliation; it is not a backup. Storage failures stop signing/submission, and unsupported Web Locks stop payments. Older operation records or unresolved records for another deployment block new payments until reconciled; do not delete evidence to bypass the guard. The previous sample retained pending payments only in tab memory, so resolve any existing in-flight payment before updating or reloading that version.

If Freighter is missing, detection stops after two seconds and shows install/enable guidance. Access requests also have a bounded wait; open the extension and try again if it does not respond. Freighter signs only in the browser; the application never receives customer keys.

A real end-to-end wallet/payout rehearsal is still required after configuring the deployment. Automated tests use mocked Paiflow responses and do not establish that a live deployment is funded or ready.

## Sample structure

- `app/page.tsx`: resolves only non-secret setup state on the server.
- `components/snack-stand.tsx`: menu, checkout, receipt, and expandable cursor-based transaction history; no bearer token in browser calls.
- `components/contribution-jars.tsx` and `lib/jar-totals.ts`: animated coin jars and exact contributions from matched payment/payout events.
- `public/snack-logo.svg`: shared cheese-bread header logo and tab icon, configured in `app/layout.tsx`.
- `lib/menu.ts`: three menu items, exact stroop prices and split arithmetic using bigint. Edit this to change the menu.
- `lib/checkout.ts` and `app/api/pay/route.ts`: accept `{ from, itemId }`; calculate the price on the server. Reject client-supplied prices, recipient overrides and unknown fields. Signed submission carries `{ signedXdr, preparationRequestId? }`; status requests carry `{ action: "status", txHash }`. Mutations require the application origin.
- `lib/paiflow.ts`, `lib/wallet.ts`, and `lib/amount.ts`: provide the server-side integration, mainnet refusal and amount helpers. Paiflow calls use the server-only SDK adapter; Freighter signs in the browser.
- `lib/recovery.ts` and `lib/transaction.ts`: deployment-scoped browser recovery, original transaction hashes and exact signed-body checks, adapted from the SDK starter.
- The stand uses fixed contract recipients and exposes no payout proxy or early-release route.

This is checkout plumbing for a hackathon, with no auth, stock or fulfilment system. The selected snack is saved in browser recovery but is not stored in the contract or a durable server order database. Server-calculated preparation prices do not make the UI receipt an authorisation to deliver real goods. Add verified order-to-transaction binding and your own app authorisation before extending it into a real store.

Read [llms.md](llms.md) for shared Paiflow SDK and product context and [the Paiflow OpenAPI document](https://beta.app.paiflow.xyz/api/v1/openapi.json) for endpoint details.

## Checks

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm check:bundles
pnpm audit
```

Tests cover the published SDK adapter and credential families, exact menu totals, price tampering, mode and origin guards, USDC capabilities, missing-wallet timeouts, storage before signing/submission, reload recovery, Web Locks, mismatched hashes and unresolved outcomes. React test renderer is a development-only dependency for checking the payment component’s recovery ordering and duplicate-payment guards. CI runs these checks and builds with a dummy credential marker; `check:bundles` verifies server credential markers are absent from browser assets. Before publishing with real configuration, also check the browser bundles for your actual token without printing it.
