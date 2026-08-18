import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
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
const legacyTarget = join(assetsDir, "context-voice-capture");
const target = join(assetsDir, "context-voice-capture.app");
const contentsDir = join(target, "Contents");
const macOSDir = join(contentsDir, "MacOS");
const appBinary = join(macOSDir, "context-voice-capture");

rmSync(legacyTarget, { force: true });
rmSync(target, { force: true, recursive: true });
mkdirSync(macOSDir, { recursive: true });
copyFileSync(binary, appBinary);
copyFileSync(join(helperDir, "Info.plist"), join(contentsDir, "Info.plist"));
chmodSync(appBinary, 0o755);

const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", target], { stdio: "inherit" });
if (sign.status !== 0) process.exit(sign.status ?? 1);
