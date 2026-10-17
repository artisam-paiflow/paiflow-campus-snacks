import "server-only";
import { handle, InputError, paymentBody } from "@/lib/http";
import { menuItem, priceBreakdown } from "@/lib/menu";
import { publicConfig, requireIntegration } from "@/lib/paiflow";

export function storeConfig() {
  const config = publicConfig();
  const ready = config.mode === "team";
  return { ...config, ready };
}

export function requireStore() {
  requireIntegration();
}

export async function checkoutBody(request: Request) {
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 210000) throw new InputError("Request too large.");
    body = JSON.parse(text);
  } catch {
    throw new InputError("Expected JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new InputError("Expected an object.");
  const value = body as Record<string, unknown>;
  if (value.action === "status") {
    if (
      Object.keys(value).length !== 2 ||
      typeof value.txHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.txHash)
    )
      throw new InputError("Supply only a transaction hash for status.");
    return { txHash: value.txHash };
  }
  if ("signedXdr" in value)
    return paymentBody(
      new Request(request.url, { method: "POST", body: JSON.stringify(value) }),
    );
  if (Object.keys(value).some((key) => key !== "from" && key !== "itemId"))
    throw new InputError(
      "Supply only a customer public address and menu item ID. Prices are set by the server.",
    );
  let item;
  try {
    item = menuItem(value.itemId);
  } catch {
    throw new InputError("Choose a snack from the menu.");
  }
  const { amount } = priceBreakdown(item);
  return paymentBody(
    new Request(request.url, {
      method: "POST",
      body: JSON.stringify({ from: value.from, amount }),
    }),
  );
}

export { handle };
