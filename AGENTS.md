Read `llms.md` first; it is the shared event-neutral SDK and product guide. Follow the event's participant brief and organisers for preparation and integration permissions. This is a sample app; use its README and current source for its configuration.

- Call Paiflow only through the published `@paiflow/sdk@0.2.0` through server-only `lib/paiflow.ts`; keep the deployment token in server environment variables. Never use `NEXT_PUBLIC_` for configuration or return tokens to the browser.
- Never handle a customer's secret key. Freighter signs XDR in the browser, using the prepared network passphrase. Refuse mainnet.
- Use `lib/amount.ts` for money. Amounts are decimal/stroops strings with bigint arithmetic, never floating-point numbers.
- Persist preparation before signing and signed envelopes before submission in deployment-scoped browser recovery. Use Web Locks for payment transitions; preserve the original hash/body and preparation history ID. Only independently checked final SUCCESS/FAILED permits acknowledging the record. UNKNOWN, rejection, local expiry and missing history never allow replacement. Keep unresolved signed envelopes; retry that same envelope, never duplicate a payment.
- This sample uses a fixed 90/10 USDC Split. Keep recipients in the deployed flow. Add your app's authorisation before introducing recipient mutations or `releaseEarly`; this sample has no release route.
- Keep prepare/team mode guards in the UI, routes and server client. Default to prepare even when credentials exist; never enable shared demo mode.
- Require the stand's deployment ID and API token before calling Paiflow. Never fall back to another deployment. Accept menu item IDs and calculate prices on the server, never accept browser prices.
- Accept both pfd* developer and pfk* deployment tokens on the server; always use the fixed configured deployment ID. Require supported testnet USDC deposit/execute capabilities and the exact Circle issuer. Do not expose payout or early-release routes.
- Run `pnpm typecheck`, `pnpm build && pnpm test` after edits. Check `.next/static` for credential leaks.
