import { storeConfig } from "@/lib/checkout";
import { SnackStand } from "@/components/snack-stand";

// Resolve server configuration per request, rather than during the build.
export const dynamic = "force-dynamic";

export default function Page() {
  return <SnackStand config={storeConfig()} />;
}
