import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("Skipping macOS-only Voice Capture Swift package on non-macOS.");
  process.exit(0);
}

const result = spawnSync("swift", process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
  console.error(`Could not run Swift: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
