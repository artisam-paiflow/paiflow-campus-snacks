import "server-only";
import { PaiflowApiError } from "@paiflow/sdk";
import { PaiflowError } from "@/lib/paiflow";
export async function handle(action: () => Promise<unknown>) {
  try {
    return Response.json({ data: await action() });
  } catch (error) {
    if (error instanceof PaiflowApiError) {
      const headers = new Headers();
      if (error.metadata.retryAfter)
        headers.set("Retry-After", error.metadata.retryAfter);
      if (error.metadata.requestId)
        headers.set("x-request-id", error.metadata.requestId);
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers },
      );
    }
    if (error instanceof PaiflowError) {
      const headers = new Headers();
      if (error.retryAfter) headers.set("Retry-After", error.retryAfter);
      if (error.requestId) headers.set("x-request-id", error.requestId);
      return Response.json(
        { error: error.api },
        { status: error.status, headers },
      );
    }
    if (error instanceof InputError)
      return Response.json(
        { error: { code: "VALIDATION", message: error.message } },
        { status: 422 },
      );
    // Do not expose upstream bodies, credentials, or signed envelopes in generic errors.
    return Response.json(
      {
        error: {
          code: "UPSTREAM_RPC",
          message:
            "Request could not be completed. If already submitted, check the same signed envelope again.",
        },
      },
      { status: 502 },
    );
  }
}
export class InputError extends Error {}
type SignedBody = { signedXdr: string; preparationRequestId?: string };
type ExecuteBody = { from: string; amount: string };
type PayoutBody = ExecuteBody & { recipient: string; nodeId?: string };
export function paymentBody(
  request: Request,
  payout: true,
): Promise<SignedBody | PayoutBody>;
export function paymentBody(
  request: Request,
  payout?: false,
): Promise<SignedBody | ExecuteBody>;
export async function paymentBody(
  request: Request,
  payout = false,
): Promise<SignedBody | ExecuteBody | PayoutBody> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InputError("Expected JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new InputError("Expected an object.");
  const value = body as Record<string, unknown>;
  if ("signedXdr" in value) {
    if (
      Object.keys(value).some(
        (key) => !["signedXdr", "preparationRequestId"].includes(key),
      ) ||
      (value.preparationRequestId !== undefined &&
        (typeof value.preparationRequestId !== "string" ||
          value.preparationRequestId.length > 200)) ||
      typeof value.signedXdr !== "string" ||
      !value.signedXdr ||
      value.signedXdr.length > 200_000
    )
      throw new InputError("Supply only a signedXdr string.");
    return {
      signedXdr: value.signedXdr,
      ...(value.preparationRequestId === undefined
        ? {}
        : { preparationRequestId: value.preparationRequestId as string }),
    };
  }
  const keys = payout
    ? ["from", "amount", "recipient", "nodeId"]
    : ["from", "amount"];
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    typeof value.from !== "string" ||
    !/^G[A-Z2-7]{55}$/.test(value.from) ||
    typeof value.amount !== "string" ||
    !/^[1-9]\d{0,38}$/.test(value.amount) ||
    BigInt(value.amount) > (1n << 127n) - 1n
  )
    throw new InputError(
      "Supply a public G-address and positive integer stroops fitting i128.",
    );
  if (payout) {
    const { recipient, nodeId } = value;
    if (
      typeof recipient !== "string" ||
      !/^G[A-Z2-7]{55}$/.test(recipient) ||
      (nodeId !== undefined &&
        (typeof nodeId !== "string" || !nodeId || nodeId.length > 200))
    )
      throw new InputError(
        "Supply a recipient public G-address and optional nonempty nodeId.",
      );
    return {
      from: value.from,
      amount: value.amount,
      recipient,
      ...(nodeId === undefined ? {} : { nodeId }),
    };
  }
  return { from: value.from, amount: value.amount };
}

export function sameOrigin(request: Request) {
  // Railway terminates TLS before forwarding to Next.js. Its internal request
  // URL is not the browser origin. Trust deployment configuration, never caller-
  // supplied Forwarded/X-Forwarded-* headers, for the external origin.
  const configured =
    process.env.APP_ORIGIN ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : new URL(request.url).origin);
  let expected: URL;
  try {
    expected = new URL(configured);
    if (
      (expected.protocol !== "https:" &&
        !(
          expected.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname)
        )) ||
      expected.username ||
      expected.password ||
      expected.pathname !== "/" ||
      expected.search ||
      expected.hash
    )
      throw new Error("Invalid origin");
  } catch {
    throw new InputError(
      "Configure APP_ORIGIN as this application's public origin.",
    );
  }
  if (request.headers.get("origin") !== expected.origin)
    throw new InputError(
      "Use this application's own origin for payment requests.",
    );
}
