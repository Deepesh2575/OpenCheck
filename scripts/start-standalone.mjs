import { cp } from "node:fs/promises";
import { spawn } from "node:child_process";

await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
await cp("public", ".next/standalone/public", { recursive: true });

const server = spawn(process.execPath, ["server.js"], {
  cwd: ".next/standalone",
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.on("error", (error) => {
  console.error("Could not start the OpenCheck production server.", error);
  process.exitCode = 1;
});

server.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
