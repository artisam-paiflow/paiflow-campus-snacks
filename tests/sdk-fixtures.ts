import { fixturePrepared } from "./transaction-fixture";
export {
  fixturePrepared,
  fixtureAddress,
  fixtureTransaction,
} from "./transaction-fixture";
export const deployment = "11111111-1111-4111-8111-111111111111";
export const capabilities = {
  deploymentId: deployment,
  network: "testnet",
  configurationSource: "deployment_snapshot",
  triggerType: "deposit",
  inputAsset: { kind: "known", symbol: "USDC" },
  operations: Object.fromEntries(
    [
      "execute",
      "events",
      "balances",
      "funding",
      "transactions",
      "releaseEarly",
      "payouts",
      "webhook",
      "subscriptionAllowance",
      "subscriptionState",
      "subscriptionCancel",
      "subscriptionReactivate",
      "swapQuote",
      "scheduleState",
      "scheduleControls",
    ].map((key) => [
      key,
      {
        status: "supported",
        authentication: "deployment_token",
        requirements: [],
        nodeIds: [],
      },
    ]),
  ),
};
export const ok = (data: unknown, headers?: HeadersInit) =>
  Response.json({ data }, { headers });
export const prepared = fixturePrepared;
