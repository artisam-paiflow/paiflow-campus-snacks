import { listEvents, publicConfig } from "@/lib/paiflow";
import { handle, InputError } from "@/lib/http";
export async function GET(request: Request) {
  return handle(async () => {
    const params = new URL(request.url).searchParams;
    const cursor = params.get("cursor");
    if (
      [...params.keys()].some((key) => key !== "cursor") ||
      (cursor !== null && (!cursor || cursor.length > 512))
    )
      throw new InputError("Invalid cursor query.");
    return {
      ...(await listEvents({ cursor: cursor ?? undefined })),
      ...publicConfig(),
    };
  });
}
