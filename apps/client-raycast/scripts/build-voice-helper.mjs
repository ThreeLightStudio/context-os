import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("Skipping macOS Voice Capture helper build on non-macOS.");
  process.exit(0);
}

const extensionDir = resolve(new URL("..", import.meta.url).pathname);
const helperDir = resolve(extensionDir, "../voice-capture");
const build = spawnSync("swift", ["build", "-c", "release", "--package-path", helperDir], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const binary = join(helperDir, ".build", "arm64-apple-macosx", "release", "context-voice-capture");
const assetsDir = join(extensionDir, "assets");
mkdirSync(assetsDir, { recursive: true });
const target = join(assetsDir, "context-voice-capture");
copyFileSync(binary, target);
chmodSync(target, 0o755);
