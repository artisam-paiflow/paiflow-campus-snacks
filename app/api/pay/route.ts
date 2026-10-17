import { prepareExecute, submitExecute, paymentStatus } from "@/lib/paiflow";
import { checkoutBody, handle, requireStore } from "@/lib/checkout";
import { sameOrigin } from "@/lib/http";
export async function POST(request: Request) {
  return handle(async () => {
    requireStore();
    sameOrigin(request);
    const body = await checkoutBody(request);
    return "txHash" in body
      ? paymentStatus(body.txHash)
      : "signedXdr" in body
        ? submitExecute(body)
        : prepareExecute(body);
  });
}
