Read `llms.md` first; it is the shared event-neutral SDK and product guide. Follow the event's participant brief and organisers for preparation and integration permissions. This is a sample app; use its README and current source for its configuration.

- Call Paiflow only through server-only `lib/paiflow.ts`; keep the deployment token in server environment variables. Never use `NEXT_PUBLIC_` for configuration or return tokens to the browser.
- Never handle a customer's secret key. Freighter signs XDR in the browser, using the prepared network passphrase. Refuse mainnet.
- Use `lib/amount.ts` for money. Amounts are decimal/stroops strings with bigint arithmetic, never floating-point numbers.
- Keep signed envelopes for PENDING and uncertain submission errors; retry that same envelope, never duplicate a payment.
- This sample uses a fixed 90/10 USDC Split. Keep recipients in the deployed flow. Add your app's authorisation before introducing recipient mutations or `releaseEarly`; this sample has no release route.
- Keep prepare/team mode guards in the UI, routes and server client. Default to prepare even when credentials exist; never enable shared demo mode.
- Require the stand's deployment ID and API token before calling Paiflow. Never fall back to another deployment. Accept menu item IDs and calculate prices on the server, never accept browser prices.
- Run `pnpm typecheck`, `pnpm build && pnpm test` after edits. Check `.next/static` for credential leaks.
