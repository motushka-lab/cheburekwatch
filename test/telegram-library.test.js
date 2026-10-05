"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { telegramRequest } = require("../lib/telegram-request");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(30);
  }
  throw new Error("Timed out waiting for test condition");
}
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

test("Telegram HTTP requests respect the configured deadline and API errors", async t => {
  const mock = http.createServer((req, res) => {
    if (req.url === "/slow") return;
    res.end(JSON.stringify({ ok:false, description:"file too big" }));
  });
  const port = await listen(mock);
  t.after(() => { mock.closeAllConnections(); mock.close(); });
  await assert.rejects(telegramRequest(`http://127.0.0.1:${port}/slow`, {}, 50), /timed out/);
  await assert.rejects(telegramRequest(`http://127.0.0.1:${port}/error`, {}, 1000), /file too big/);
});

test("large Telegram upload, authenticated playback, seek and restart", { timeout:20000 }, async t => {
  const root = await fs.mkdtemp(path.join(__dirname, "..", ".test-telegram-"));
  const dataDir = path.join(root, "data");
  const localDir = path.join(dataDir, "telegram");
  await fs.mkdir(localDir, { recursive:true });
  const video = path.join(localDir, "large.mp4");
  const size = 350 * 1024 * 1024;
  const file = await fs.open(video, "w");
  await file.truncate(size); // sparse 350 MB file: test ranges without buffering it
  await file.write(Buffer.from("START"), 0, 5, 0);
  await file.write(Buffer.from("END!!"), 0, 5, size - 5);
  await file.close();
  const outside = path.join(root, "outside.mp4");
  await fs.writeFile(outside, "private");
  await fs.writeFile(path.join(dataDir, "db.json"), JSON.stringify({
    users:[{ id:"user", nickname:"Tester" }],
    sessions:[{ id:"session", userId:"user", expiresAt:"2099-01-01T00:00:00Z" }],
    rooms:[], messages:[], animeLibrary:[]
  }));

  const updates = [];
  const messages = [];
  let updateId = 1;
  let getFiles = 0;
  let releaseDownload;
  const downloading = new Promise(resolve => { releaseDownload = resolve; });
  const mock = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const method = req.url.split("/").pop();
    let result;
    if (method === "getMe") result = { username:"test_bot" };
    else if (method === "getUpdates") {
      if (!updates.length) await sleep(100);
      result = updates.splice(0);
    } else if (method === "sendMessage") { messages.push(body.text); result = {}; }
    else if (method === "getFile") {
      getFiles++;
      if (body.file_id === "large") await downloading;
      if (body.file_id === "bad") return res.end(JSON.stringify({ ok:false, description:"download failed" }));
      result = { file_path:body.file_id === "outside" ? outside : video };
    } else { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok:true, result }));
  });
  const mockPort = await listen(mock);
  const reserve = http.createServer();
  const webPort = await listen(reserve);
  await new Promise(resolve => reserve.close(resolve));
  const base = `http://127.0.0.1:${webPort}`;
  let child;
  let output = "";
  function start() {
    child = spawn(process.execPath, ["server.js"], {
      cwd:path.join(__dirname, ".."),
      env:{ ...process.env, NODE_ENV:"test", COOKIE_SECURE:"false", PORT:String(webPort), HOST:"127.0.0.1",
        DATA_DIR:dataDir, TELEGRAM_BOT_TOKEN:"123:fake", TELEGRAM_ADMIN_ID:"7",
        TELEGRAM_LOCAL_API:"true", TELEGRAM_LOCAL_DIR:localDir,
        TELEGRAM_BOT_API_BASE:`http://127.0.0.1:${mockPort}` },
      stdio:["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const ended = once(child, "exit");
    child.kill("SIGTERM");
    await ended;
  }
  t.after(async () => {
    releaseDownload();
    await stop();
    mock.closeAllConnections();
    await new Promise(resolve => mock.close(resolve));
    await fs.rm(root, { recursive:true, force:true });
  });
  const library = async () => {
    const response = await fetch(`${base}/api/anime/library`, { headers:{ Cookie:"sid=session" } });
    assert.equal(response.status, 200);
    return response.json();
  };
  function upload(title, fileId, sender = 7, fileSize = size) {
    updates.push({ update_id:updateId++, message:{ chat:{ id:7 }, from:{ id:sender },
      caption:`${title} | 1`, document:{ file_id:fileId, file_unique_id:fileId,
        file_size:fileSize, mime_type:"video/mp4", file_name:"Серия 01.mp4" } } });
  }
  start();
  await until(() => fetch(`${base}/health`).then(r => r.ok).catch(() => false));

  await t.test("upload is published only after the large file is ready", async () => {
    upload("Large", "large");
    await until(() => getFiles === 1);
    assert.equal((await library()).items.length, 0);
    assert.ok(messages.some(text => text.includes("Скачиваю")));
    releaseDownload();
    await until(async () => (await library()).items.length === 1);
    await until(() => messages.some(text => text.includes("Сохранено: Large")));
  });
  const item = (await library()).items[0];
  const mediaUrl = new URL(item.url).pathname;
  await t.test("media URL does not expose Telegram credentials or local path", async () => {
    const json = JSON.stringify(await library());
    assert.ok(!json.includes("123:fake"));
    assert.ok(!json.includes(localDir));
    assert.equal((await fetch(base + mediaUrl)).status, 401);
  });
  await t.test("partial and suffix ranges support seeking without another getFile", async () => {
    const response = await fetch(base + mediaUrl, { headers:{ Cookie:"sid=session", Range:"bytes=0-4" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes 0-4/${size}`);
    assert.equal(await response.text(), "START");
    const suffix = await fetch(base + mediaUrl, { headers:{ Cookie:"sid=session", Range:"bytes=-5" } });
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), "END!!");
    const open = await fetch(base + mediaUrl, { headers:{ Cookie:"sid=session", Range:`bytes=${size-5}-` } });
    assert.equal(open.status, 206);
    assert.equal(await open.text(), "END!!");
    const invalid = await fetch(base + mediaUrl, { headers:{ Cookie:"sid=session", Range:`bytes=${size}-` } });
    assert.equal(invalid.status, 416);
    assert.equal(getFiles, 1);
  });
  await t.test("downloads are admin-only and failures do not publish broken records", async () => {
    upload("Unauthorized", "unauthorized", 8);
    await until(() => messages.includes("Нет доступа к библиотеке."));
    assert.equal(getFiles, 1);
    upload("Bad", "bad");
    await until(() => messages.some(text => text.includes("Запись не добавлена")));
    assert.equal((await library()).items.length, 1);
    upload("Outside", "outside");
    await until(() => messages.filter(text => text.includes("Запись не добавлена")).length === 2);
    assert.equal((await library()).items.length, 1);
  });
  await t.test("disk capacity is checked before downloading", async () => {
    const disk = await fs.statfs(localDir);
    upload("No space", "no-space", 7, Number(disk.bavail) * Number(disk.bsize) + 1);
    await until(() => messages.some(text => text.includes("Недостаточно места")));
    assert.equal(getFiles, 3);
    assert.equal((await library()).items.length, 1);
  });
  await t.test("persistent library and video survive an application restart", async () => {
    await stop();
    start();
    await until(() => fetch(`${base}/health`).then(r => r.ok).catch(() => false));
    assert.equal((await library()).items[0].id, item.id);
    const response = await fetch(base + mediaUrl, { headers:{ Cookie:"sid=session", Range:"bytes=-5" } });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), "END!!");
    assert.equal(getFiles, 3);
  });
  assert.ok(!output.includes("123:fake"));
});
