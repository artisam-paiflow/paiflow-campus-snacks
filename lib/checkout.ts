import "server-only";
import { handle, InputError, paymentBody } from "@/lib/http";
import { menuItem, priceBreakdown } from "@/lib/menu";
import { publicConfig } from "@/lib/paiflow";

export function storeConfig() {
  const config = publicConfig();
  const ready = !config.demoMode && !!process.env.PAIFLOW_DEPLOYMENT_ID?.trim();
  return { ready, deploymentUrl: ready ? config.deploymentUrl : null };
}

export function requireStore() {
  if (!storeConfig().ready)
    throw new InputError(
      "Set the snack stand's deployment ID and API token on the server first.",
    );
}

export async function checkoutBody(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InputError("Expected JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new InputError("Expected an object.");
  const value = body as Record<string, unknown>;
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
