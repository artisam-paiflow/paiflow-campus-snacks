import "server-only";
import { Paiflow } from "@paiflow/sdk";
import { StrKey } from "@stellar/stellar-sdk";
import { envelopeHash } from "@/lib/transaction";
export type { Prepared, Submitted } from "@/lib/types";
import type { Prepared, Submitted } from "@/lib/types";
export const USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
type ApiFailure = {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
  details?: string;
};
export class PaiflowError extends Error {
  constructor(
    readonly status: number,
    readonly api: ApiFailure,
    readonly retryAfter: string | null,
    readonly requestId: string | null,
  ) {
    super(api.message);
  }
}
type Config = { origin: string; deploymentId: string; token: string };
export type Mode = "prepare" | "team";
export type PublicConfig =
  | { mode: "prepare"; deploymentUrl: null }
  | { mode: "team"; deploymentUrl: string; scope: string }
  | { mode: "disabled"; deploymentUrl: null; message: string };

function configurationError(message: string): never {
  throw new PaiflowError(503, { code: "CONFIGURATION", message }, null, null);
}
function mode(): Mode {
  const value = process.env.PAIFLOW_MODE?.trim() ?? "prepare";
  if (value === "prepare" || value === "team") return value;
  return configurationError(
    "Set PAIFLOW_MODE to prepare or team. Campus Snacks does not support the shared demo.",
  );
}
function origin() {
  try {
    const url = new URL(
      process.env.PAIFLOW_BASE_URL || "https://beta.app.paiflow.xyz",
    );
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return configurationError("Set PAIFLOW_BASE_URL to a platform origin.");
    return url.origin;
  } catch {
    return configurationError("Set PAIFLOW_BASE_URL to a platform origin.");
  }
}
function teamConfig(): Config {
  const token = process.env.PAIFLOW_API_TOKEN?.trim();
  const deploymentId = process.env.PAIFLOW_DEPLOYMENT_ID?.trim();
  if (!token || !deploymentId)
    return configurationError(
      "Team mode requires PAIFLOW_API_TOKEN and PAIFLOW_DEPLOYMENT_ID.",
    );
  if (!/^(pfk|pfd)_[a-f0-9]{64}$/.test(token))
    return configurationError(
      "Set a valid developer or deployment API token for team mode.",
    );
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      deploymentId,
    )
  )
    return configurationError("Set a valid deployment UUID for team mode.");
  return { origin: origin(), deploymentId, token };
}
export function requireIntegration(): "team" {
  const selected = mode();
  switch (selected) {
    case "prepare":
      throw new PaiflowError(
        403,
        {
          code: "PREPARATION_MODE",
          message:
            "Payments and the live feed are disabled in preparation mode.",
        },
        null,
        null,
      );
    case "team":
      teamConfig();
      return selected;
    default: {
      const unreachable: never = selected;
      return unreachable;
    }
  }
}
export function publicConfig(): PublicConfig {
  try {
    const selected = mode();
    switch (selected) {
      case "prepare":
        return { mode: selected, deploymentUrl: null };
      case "team": {
        const config = teamConfig();
        return {
          mode: selected,
          scope: `${config.origin}/${config.deploymentId}`,
          deploymentUrl: new URL(
            `/deployments/${config.deploymentId}`,
            config.origin,
          ).href,
        };
      }
      default: {
        const unreachable: never = selected;
        return unreachable;
      }
    }
  } catch (error) {
    if (error instanceof PaiflowError && error.api.code === "CONFIGURATION")
      return { mode: "disabled", deploymentUrl: null, message: error.message };
    throw error;
  }
}
function deployment() {
  requireIntegration();
  const c = teamConfig();
  return new Paiflow({ baseUrl: c.origin, token: c.token }).deployment(
    c.deploymentId,
  );
}
export async function paymentReady() {
  const d = deployment();
  const { data } = await d.capabilities.get();
  const asset = data.inputAsset;
  const usdc =
    (asset?.kind === "known" && asset.symbol === "USDC") ||
    (asset?.kind === "custom" &&
      asset.code === "USDC" &&
      asset.issuer === USDC_ISSUER);
  if (
    data.network !== "testnet" ||
    !usdc ||
    data.triggerType !== "deposit" ||
    data.operations.execute.status !== "supported"
  )
    throw new Error(
      "Use an active testnet USDC Receive deployment with execute support.",
    );
  return d;
}
export async function prepareExecute(input: {
  from: string;
  amount: string;
}): Promise<Prepared> {
  requireIntegration();
  if (!StrKey.isValidEd25519PublicKey(input.from))
    throw new Error("Supply a public Stellar account.");
  const d = await paymentReady();
  const response = await d.execute.prepare(input);
  const p = response.data;
  if (
    p.network !== "testnet" ||
    p.networkPassphrase !== "Test SDF Network ; September 2015"
  )
    throw new Error("Only Testnet payments are allowed.");
  return {
    ...p,
    txHash: envelopeHash(p.xdr),
    preparationRequestId: response.metadata.historyRequestId,
  };
}
export async function submitExecute(input: {
  signedXdr: string;
  preparationRequestId?: string;
}): Promise<Submitted> {
  requireIntegration();
  const hash = envelopeHash(input.signedXdr);
  const d = await paymentReady();
  const { data } = await d.execute.submit(
    { signedXdr: input.signedXdr },
    { wait: false, preparationRequestId: input.preparationRequestId },
  );
  if (data.txHash !== hash)
    throw new Error(
      "Transaction hash mismatch. Retain the original envelope and check its status.",
    );
  return data;
}
export async function paymentStatus(txHash: string) {
  requireIntegration();
  if (!/^[a-f0-9]{64}$/.test(txHash))
    throw new Error("Invalid transaction hash.");
  const { data } = await deployment().transactions.get(txHash);
  if (data.txHash !== txHash || data.network !== "testnet")
    throw new Error(
      "Transaction evidence mismatch. Retain the original record.",
    );
  return data;
}

export type EventItem = {
  id: string;
  eventId: string;
  kind: string;
  topic: string | null;
  ledger: number;
  txHash: string;
  occurredAt: string;
  data: unknown;
};
export type EventPage = {
  items: EventItem[];
  nextCursor: string | null;
  hasMore: boolean;
};
export async function listEvents(
  input: { cursor?: string; limit?: number; txHash?: string } = {},
) {
  return deployment()
    .events.list({ ...input, cursor: input.cursor || undefined })
    .then((response) => response.data);
}
