import { prepareExecute, submitExecute } from "@/lib/paiflow";
import { checkoutBody, handle, requireStore } from "@/lib/checkout";
export async function POST(request: Request) {
  return handle(async () => {
    requireStore();
    const body = await checkoutBody(request);
    return "signedXdr" in body ? submitExecute(body) : prepareExecute(body);
  });
}
