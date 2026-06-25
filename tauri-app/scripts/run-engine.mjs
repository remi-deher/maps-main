// Launches the GPS-Mock engine sidecar binary directly — used by `npm run
// engine` / `npm run dev:headless` for browser-only development, outside of
// `tauri dev` (which normally spawns this binary itself).
//
// Implemented as a Node script rather than a raw path in package.json
// because cmd.exe on Windows doesn't reliably resolve relative paths passed
// straight to npm scripts (forward vs. backslashes, "./" handling) — Node's
// child_process bypasses that entirely by calling the binary directly.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binaryName =
  process.platform === "win32"
    ? "gpsmock-engine-x86_64-pc-windows-msvc.exe"
    : "gpsmock-engine";
const binaryPath = path.join(__dirname, "..", "src-tauri", "binaries", binaryName);

const args = process.argv.slice(2);
if (!args.includes("-addr")) args.push("-addr", ":8080");

const child = spawn(binaryPath, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
