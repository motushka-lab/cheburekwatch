"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

async function until(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error("Container did not reach the expected state");
}
test("local container requires API credentials", async () => {
  const child = spawn(process.execPath, ["scripts/start-container.js"], {
    cwd:path.join(__dirname, ".."),
    env:{ ...process.env, TELEGRAM_LOCAL_API:"true", TELEGRAM_API_ID:"", TELEGRAM_API_HASH:"", TELEGRAM_BOT_TOKEN:"" }
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(stderr, /requires TELEGRAM_BOT_TOKEN, TELEGRAM_API_ID and TELEGRAM_API_HASH/);
});

test("container migration runs once and both processes stop together", { timeout:15000 }, async t => {
  const root = await fs.mkdtemp(path.join(__dirname, "..", ".test-container-"));
  const token = "999:fake";
  const key = crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
  const binary = path.join(root, "telegram-bot-api");
  await fs.writeFile(binary, `#!/usr/bin/env node\n
const http = require('node:http');
const fs = require('node:fs');
fs.writeFileSync(process.env.TEST_ARGS, JSON.stringify(process.argv.slice(2)));
const server = http.createServer((req, res) => {
  if (req.url === '/crash') { res.end('bye'); setTimeout(() => process.exit(2), 10); return; }
  req.resume();
  const result = req.url.endsWith('/getMe') ? { username:'test_bot' } : [];
  res.end(JSON.stringify({ ok:true, result }));
});
server.listen(8081, '127.0.0.1');
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
`, { mode:0o755 });
  const preload = path.join(root, "mock-cloud.cjs");
  await fs.writeFile(preload, `
const original = global.fetch;
global.fetch = async (url, options) => {
  if (String(url).startsWith('https://api.telegram.org/')) {
    require('node:fs').appendFileSync(process.env.TEST_MIGRATIONS, 'logout\\n');
    return { ok:true, json:async () => ({ ok:true, result:true }) };
  }
  return original(url, options);
};
`);
  const reserve = http.createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  let output = "";
  function start() {
    child = spawn(process.execPath, ["scripts/start-container.js"], {
      cwd:path.join(__dirname, ".."),
      env:{ ...process.env, NODE_ENV:"test", DATA_DIR:path.join(root, "data"), HOST:"127.0.0.1", PORT:String(port),
        PATH:`${root}:${process.env.PATH}`, NODE_OPTIONS:`--require=${preload}`,
        TELEGRAM_LOCAL_API:"true", TELEGRAM_LOCAL_DIR:path.join(root, "data", "telegram"),
        TELEGRAM_API_ID:"123", TELEGRAM_API_HASH:"a".repeat(32), TELEGRAM_BOT_TOKEN:token,
        TELEGRAM_ADMIN_ID:"7", TELEGRAM_MIGRATE_FROM_CLOUD:"true",
        TEST_ARGS:path.join(root, "args.json"), TEST_MIGRATIONS:path.join(root, "migrations") },
      stdio:["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGTERM");
      await ended;
    }
  }
  t.after(async () => {
    if (!output.includes("Local Telegram Bot API ready")) t.diagnostic(output);
    await stop(); await fs.rm(root, { recursive:true, force:true });
  });
  start();
  await until(() => fetch(base + "/health").then(r => r.ok).catch(() => false));
  assert.equal(await fs.readFile(path.join(root, "migrations"), "utf8"), "logout\n");
  await fs.access(path.join(root, "data", "telegram", `.cloud-migrated-${key}`));
  const args = JSON.parse(await fs.readFile(path.join(root, "args.json"), "utf8"));
  assert.ok(args.includes("--local"));
  assert.ok(args.includes("--http-ip-address=127.0.0.1"));
  assert.ok(!args.some(arg => arg.includes(token) || arg.includes("a".repeat(32))));
  await stop();
  assert.equal(child.exitCode, 0);
  start();
  await until(() => fetch(base + "/health").then(r => r.ok).catch(() => false));
  assert.equal(await fs.readFile(path.join(root, "migrations"), "utf8"), "logout\n");
  const ended = once(child, "exit");
  await fetch("http://127.0.0.1:8081/crash");
  const [code] = await ended;
  assert.equal(code, 2);
  await until(() => fetch(base + "/health").then(() => false).catch(() => true));
  assert.ok(!output.includes(token));
});
