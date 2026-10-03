import { prepareExecute, submitExecute } from "@/lib/paiflow";
import { handle, paymentBody } from "@/lib/http";
export async function POST(request: Request) {
  return handle(async () => {
    const body = await paymentBody(request);
    return "signedXdr" in body ? submitExecute(body) : prepareExecute(body);
  });
}
