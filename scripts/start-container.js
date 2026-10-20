"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");

const children = new Set();
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  if (!children.size) process.exit(code);
  const deadline = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code || 1);
  }, 12000);
  for (const child of children) child.once("exit", () => {
    if (!children.size) { clearTimeout(deadline); process.exit(code); }
  });
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));

function launch(command, args, env = process.env) {
  const child = spawn(command, args, { stdio: "inherit", env });
  children.add(child);
  child.once("error", () => {
    children.delete(child);
    console.error("Could not start a container process.");
    stop(1);
  });
  child.once("exit", code => {
    children.delete(child);
    if (!stopping) {
      console.error(`Container process exited (${code ?? "signal"}).`);
      stop(code || 1);
    }
  });
  return child;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function portReady(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, "127.0.0.1");
    const finish = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}
async function api(base, token, method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${base}/bot${token}/${method}`, { method: "POST", signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error("Telegram request failed");
    return data.result;
  } finally { clearTimeout(timeout); }
}

async function main() {
  const enabled = process.env.TELEGRAM_LOCAL_API === "true";
  const webEnv = { ...process.env };
  delete webEnv.TELEGRAM_API_HASH;
  delete webEnv.TELEGRAM_API_ID;
  if (enabled) {
    const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!token || !/^\d+$/.test(process.env.TELEGRAM_API_ID || "") ||
        !/^[a-f0-9]{32}$/i.test(process.env.TELEGRAM_API_HASH || "")) {
      throw new Error("Local Bot API requires TELEGRAM_BOT_TOKEN, TELEGRAM_API_ID and TELEGRAM_API_HASH in Render Environment.");
    }
    const root = path.resolve(process.env.TELEGRAM_LOCAL_DIR || path.join(process.env.DATA_DIR || "/var/data", "telegram"));
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(root, "tmp"), { recursive: true, mode: 0o700 });
    const base = "http://127.0.0.1:8081";
    launch("telegram-bot-api", ["--local", "--http-ip-address=127.0.0.1", "--http-port=8081",
      `--dir=${root}`, `--temp-dir=${path.join(root, "tmp")}`, `--log=${path.join(root, "bot-api.log")}`]);
    const deadline = Date.now() + 120000;
    while (!stopping && !(await portReady(8081))) {
      if (Date.now() > deadline) throw new Error("Local Bot API did not open its listening port.");
      await delay(500);
    }
    if (stopping) return;
    // A marker per token prevents logging out from the cloud on every redeploy.
    const key = crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
    const marker = path.join(root, `.cloud-migrated-${key}`);
    const migrated = await fs.access(marker).then(() => true, () => false);
    if (!migrated && process.env.TELEGRAM_MIGRATE_FROM_CLOUD === "true") {
      await api("https://api.telegram.org", token, "logOut");
      await fs.writeFile(marker, "Cloud logout completed\n", { mode: 0o600 });
      console.log("Telegram bot migrated from the cloud API.");
    }
    let ready = false;
    while (!stopping && !ready) {
      try { await api(base, token, "getMe"); ready = true; }
      catch {
        if (Date.now() > deadline) throw new Error("Local Bot API authentication failed; check API credentials and cloud migration.");
        await delay(1000);
      }
    }
    if (stopping) return;
    webEnv.TELEGRAM_BOT_API_BASE = base;
    webEnv.TELEGRAM_LOCAL_DIR = root;
    console.log("Local Telegram Bot API ready; starting CheburekWatch.");
  }
  if (!stopping) launch(process.execPath, [path.join(__dirname, "..", "server.js")], webEnv);
}
main().catch(error => { console.error(error.message); stop(1); });
