import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function bundles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await bundles(path)));
    else if (/\.(js|json|map)$/.test(entry.name)) paths.push(path);
  }
  return paths;
}

const paths = await bundles(".next/static");
if (!paths.length)
  throw new Error("Build the app before scanning browser bundles.");
for (const path of paths) {
  if (
    /pfk_|PAIFLOW_API_TOKEN|campus-snacks-build-canary/.test(
      await readFile(path, "utf8"),
    )
  )
    throw new Error(
      `Server credential marker found in browser bundle: ${path}`,
    );
}
process.stdout.write(
  `Credential scan passed for ${paths.length} browser assets.\n`,
);
