const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESSION_DAYS = 30;
const MAX_MESSAGE = 500;
const MAX_NICK = 24;

const SITE_MEDIA_TARS = [
  "cw-media-a.tar",
  "cw-media-v1.tar",
  "cw-media-v2.tar",
  "cw-media-v3.tar",
  "cw-media-hero.tar"
].map(name => path.join(__dirname, "assets", name));
const SITE_MEDIA_DIR = path.join(__dirname, ".runtime-media");
const USER_HERO_PARTS_DIR = path.join(__dirname, "assets", "user-hero");

function hydrateBase64Parts(partsDir, prefix, dest) {
  if (!fs.existsSync(partsDir)) return false;
  const parts = fs.readdirSync(partsDir)
    .filter(name => name.startsWith(prefix))
    .sort();
  if (!parts.length) return false;
  const encoded = parts.map(name => fs.readFileSync(path.join(partsDir, name), "utf8")).join("").replace(/\s+/g, "");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(encoded, "base64"));
  return true;
}


function extractSiteMediaTar(tarFile, outDir) {
  if (!fs.existsSync(tarFile)) return false;
  const data = fs.readFileSync(tarFile);
  fs.mkdirSync(outDir, { recursive: true });
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const rawSize = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = parseInt(rawSize || "0", 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    offset += 512;

    const cleanName = rawName
      .replace(/^\.\//, "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(part => part && part !== "." && part !== "..")
      .join("/");
    if (cleanName) {
      const dest = path.join(outDir, cleanName);
      if (type === "5") {
        fs.mkdirSync(dest, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, data.subarray(offset, offset + size));
      }
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return true;
}

try {
  fs.rmSync(SITE_MEDIA_DIR, { recursive: true, force: true });
  fs.mkdirSync(SITE_MEDIA_DIR, { recursive: true });
  let extracted = 0;
  for (const tarFile of SITE_MEDIA_TARS) {
    if (extractSiteMediaTar(tarFile, SITE_MEDIA_DIR)) extracted++;
  }
  if (extracted) console.log(`Site media bundles ready: ${extracted}`);
} catch (error) {
  console.warn("Site media bundles could not be extracted:", error.message);
}

try {
  const userHeroTar = path.join(__dirname, ".runtime-user-hero.tar");
  if (hydrateBase64Parts(USER_HERO_PARTS_DIR, "main-intro-desktop.b64.", userHeroTar)) {
    extractSiteMediaTar(userHeroTar, SITE_MEDIA_DIR);
    fs.rmSync(userHeroTar, { force: true });
    console.log("Corrected desktop hero bundle ready");
  }
} catch (error) {
  console.warn("Corrected desktop hero bundle could not be prepared:", error.message);
}


fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], sessions: [], rooms: [], messages: [] }, null, 2));
}

let db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
const sseClients = new Map(); // roomCode -> Set(response)
const presence = new Map();   // roomCode -> Map(userId -> {user, lastSeen})

function saveDb() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function id() { return crypto.randomUUID(); }
function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({length: 6}, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (db.rooms.some(r => r.code === code));
  return code;
}
function cleanNick(v) {
  return String(v || "").trim().replace(/\s+/g, " ").slice(0, MAX_NICK);
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map(x => {
    const i = x.indexOf("=");
    return [x.slice(0, i).trim(), decodeURIComponent(x.slice(i + 1).trim())];
  }));
}
function getUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const s = db.sessions.find(x => x.id === sid && new Date(x.expiresAt) > new Date());
  if (!s) return null;
  return db.users.find(u => u.id === s.userId) || null;
}
const PREFIXES = [
  { level: 1, name: "Лошара" },
  { level: 5, name: "Нормис" },
  { level: 10, name: "Киноман" },
  { level: 20, name: "Запойный зритель" },
  { level: 30, name: "Культовый зритель" },
  { level: 50, name: "Легенда дивана" },
  { level: 75, name: "Повелитель запоя" },
  { level: 100, name: "Мифический чебурек" }
];
const ACHIEVEMENTS = [
  { id:"first-room", title:"Первый просмотр", desc:"Войти в первую комнату", icon:"🍿" },
  { id:"first-hour", title:"Разогрелись", desc:"Посмотреть 1 час", icon:"🔥" },
  { id:"five-hours", title:"Нормальный запой", desc:"Посмотреть 5 часов", icon:"📺" },
  { id:"ten-hours", title:"Сериал закончится раньше", desc:"Посмотреть 10 часов", icon:"🫠" },
  { id:"room-host", title:"Хозяин чебуречной", desc:"Создать комнату", icon:"🏠" },
  { id:"chatty", title:"Не молчи", desc:"Отправить 10 сообщений", icon:"💬" },
  { id:"baby-unlocked", title:"Бэйби", desc:"Секретный титул создателя", icon:"🍼" }
];
function levelInfo(u) {
  const level = Math.max(1, Math.floor((Number(u.watchMinutes || 0)) / 20) + 1);
  let prefix = PREFIXES[0];
  for (const p of PREFIXES) if (level >= p.level) prefix = p;
  const currentBase = (level - 1) * 20;
  const nextBase = level * 20;
  return { level, prefix: prefix.name, watchMinutes: Number(u.watchMinutes || 0),
    progress: Math.max(0, Math.min(100, ((Number(u.watchMinutes || 0)-currentBase)/20)*100)),
    minutesToNext: Math.max(0, nextBase-Number(u.watchMinutes || 0)) };
}
function publicUser(u) {
  const li = levelInfo(u);
  const next = PREFIXES.find(p => p.level > li.level) || null;
  return { id:u.id, nickname:u.nickname, level:li.level, xp:li.watchMinutes, secretPrefix: (u.achievements||[]).includes("baby-unlocked") ? "бэйби" : null,
    watchMinutes:li.watchMinutes, prefix:li.prefix, nextPrefix:next,
    progress:li.progress, minutesToNext:li.minutesToNext, achievements:u.achievements||[] };
}
function ensureUserStats(u) {
  if (typeof u.watchMinutes !== "number") u.watchMinutes = Number(u.xp || 0);
  if (!Array.isArray(u.achievements)) u.achievements = [];
  u.xp = u.watchMinutes;
}
function requireAuth(req, res, next) {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: "Необходима авторизация" });
  req.user = u;
  next();
}
function findRoom(code) {
  return db.rooms.find(r => r.code === String(code || "").toUpperCase());
}
function isMember(room, userId) {
  return room.members.includes(userId);
}
function touchPresence(code, user) {
  if (!presence.has(code)) presence.set(code, new Map());
  presence.get(code).set(user.id, { user: publicUser(user), lastSeen: Date.now() });
}
function cleanupPresence(code) {
  const m = presence.get(code);
  if (!m) return;
  for (const [uid, p] of m) if (Date.now() - p.lastSeen > 30000) m.delete(uid);
  if (!m.size) presence.delete(code);
}
function roomSnapshot(room) {
  cleanupPresence(room.code);
  if (!room.playback) room.playback = { playing: !!room.playing, position: Number(room.position || 0), updatedAt: Number(room.updatedAt || Date.now()), by: null };
  const live = presence.get(room.code) || new Map();
  const state = room.playback || { playing: !!room.playing, position: Number(room.position || 0), updatedAt: Date.now(), by: null };
  return {
    code: room.code,
    ownerId: room.ownerId,
    createdAt: room.createdAt,
    media: room.media,
    playing: !!state.playing,
    position: Number(state.position || 0),
    updatedAt: Number(state.updatedAt || Date.now()),
    stateBy: state.by || null,
    seq: Number(state.seq || 0),
    users: [...live.values()].map(x => ({ ...x.user, online: true }))
  };
}
function broadcast(code, event, payload) {
  const set = sseClients.get(code);
  if (!set) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch {}
  }
}
function validateVideo(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error("Некорректная ссылка"); }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
    let videoId = null;
    if (host === "youtu.be") videoId = u.pathname.split("/").filter(Boolean)[0];
    else if (u.pathname === "/watch") videoId = u.searchParams.get("v");
    else if (u.pathname.startsWith("/shorts/")) videoId = u.pathname.split("/")[2];
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId || "")) throw new Error("Не удалось определить YouTube video ID");
    return { type: "youtube", url: `https://www.youtube.com/embed/${videoId}`, sourceUrl: u.href, videoId };
  }

  if (host === "vkvideo.ru" || host === "vk.com") {
    if (u.pathname === "/video_ext.php") {
      const oid = u.searchParams.get("oid");
      const vid = u.searchParams.get("id");
      if (!oid || !vid) throw new Error("Некорректная VK video_ext.php ссылка");
      const embed = new URL("https://vkvideo.ru/video_ext.php");
      embed.searchParams.set("oid", oid); embed.searchParams.set("id", vid);
      embed.searchParams.set("hd", u.searchParams.get("hd") || "2");
      embed.searchParams.set("js_api", "1");
      return { type: "vk", url: embed.href, sourceUrl: u.href, oid, id: vid };
    }
    const m = u.pathname.match(/^\/video(-?\d+)_(\d+)/);
    if (m) {
      const [, oid, vid] = m;
      const embed = new URL("https://vkvideo.ru/video_ext.php");
      embed.searchParams.set("oid", oid); embed.searchParams.set("id", vid);
      embed.searchParams.set("hd", "2"); embed.searchParams.set("js_api", "1");
      return { type: "vk", url: embed.href, sourceUrl: u.href, oid, id: vid };
    }
    throw new Error("Поддерживаются VK Video ссылки вида /video-OWNER_VIDEO");
  }

  const directExt = /\.(mp4|webm|ogg)(?:$|[?#])/i;
  if (directExt.test(u.pathname + u.search)) {
    return { type: "direct", url: u.href, sourceUrl: u.href };
  }
  throw new Error("Ссылка не поддерживается. Используйте YouTube, VK Video или .mp4/.webm/.ogg");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

// Lightweight health check for hosting platforms (Render/Railway/Fly/etc.).
app.get("/health", (req, res) => res.status(200).json({ ok: true }));
app.use("/api", (req,res,next)=>{ res.setHeader("Cache-Control","no-store"); next(); });
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Auth
app.post("/api/register", async (req, res) => {
  const nickname = cleanNick(req.body.nickname);
  const password = String(req.body.password || "");
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(nickname)) return res.status(400).json({ error: "Никнейм: 3–24 символа, буквы/цифры/_/-" });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Пароль должен содержать 8–128 символов" });
  if (db.users.some(u => u.nickname.toLowerCase() === nickname.toLowerCase())) return res.status(409).json({ error: "Никнейм уже занят" });
  const user = { id: id(), nickname, watchMinutes: 0, achievements: [], passwordHash: await bcrypt.hash(password, 12), level: 1, xp: 0, createdAt: new Date().toISOString() };
  db.users.push(user);
  saveDb();
  createSession(res, user);
  res.json({ user: publicUser(user) });
});
app.post("/api/login", async (req, res) => {
  const nickname = cleanNick(req.body.nickname);
  const password = String(req.body.password || "");
  const user = db.users.find(u => u.nickname.toLowerCase() === nickname.toLowerCase());
  if (user) ensureUserStats(user);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Неверный логин или пароль" });
  createSession(res, user);
  res.json({ user: publicUser(user) });
});
function createSession(res, user) {
  const sid = id();
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt) > new Date());
  db.sessions.push({ id: sid, userId: user.id, expiresAt: new Date(Date.now() + SESSION_DAYS*86400000).toISOString() });
  saveDb();
  const secure = process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
  res.setHeader("Set-Cookie", `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; ${secure ? "Secure; " : ""}Max-Age=${SESSION_DAYS*86400}`);
}
app.post("/api/logout", (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) { db.sessions = db.sessions.filter(s => s.id !== sid); saveDb(); }
  const secure = process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
  res.setHeader("Set-Cookie", `sid=; Path=/; HttpOnly; SameSite=Lax; ${secure ? "Secure; " : ""}Max-Age=0`);
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => {
  const user = getUser(req);
  if (user) ensureUserStats(user);
  res.json({ user: user ? publicUser(user) : null });
});

// Rooms
app.get("/api/my-rooms", requireAuth, (req, res) => {
  const rooms = db.rooms.filter(r => r.members.includes(req.user.id)).map(r => ({
    code: r.code, ownerId: r.ownerId, createdAt: r.createdAt, media: r.media,
    participantCount: (presence.get(r.code)?.size || 0)
  }));
  res.json({ rooms });
});
app.post("/api/rooms", requireAuth, (req, res) => {
  const room = {
    code: roomCode(), ownerId: req.user.id, members: [req.user.id], media: null,
    playing: false, position: 0, updatedAt: Date.now(), playback: {playing:false, position:0, updatedAt:Date.now(), by:req.user.id, seq:0}, createdAt: new Date().toISOString()
  };
  db.rooms.push(room);
  ensureUserStats(req.user);
  if (!req.user.achievements.includes("room-host")) req.user.achievements.push("room-host");
  saveDb(); touchPresence(room.code, req.user);
  res.status(201).json({ room: roomSnapshot(room) });
});
app.post("/api/rooms/:code/join", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  if (!room.members.includes(req.user.id)) room.members.push(req.user.id);
  ensureUserStats(req.user);
  if (!req.user.achievements.includes("first-room")) req.user.achievements.push("first-room");
  touchPresence(room.code, req.user); saveDb();
  broadcast(room.code, "room", roomSnapshot(room));
  res.json({ room: roomSnapshot(room) });
});
app.post("/api/rooms/:code/creator/grant", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  if (room.ownerId !== req.user.id) return res.status(403).json({ error: "Только создатель комнаты может открыть Creator Tools" });
  ensureUserStats(req.user);
  const body = req.body || {};
  if (body.level != null) {
    const lvl = Math.max(1, Math.min(10000, Math.floor(Number(body.level))));
    if (!Number.isFinite(lvl)) return res.status(400).json({error:"Некорректный уровень"});
    req.user.watchSeconds = Math.max(Number(req.user.watchSeconds || 0), Math.max(0,(lvl-1)*20)*60);
    req.user.watchMinutes = Math.max(Number(req.user.watchMinutes || 0), Math.max(0,(lvl-1)*20));
    req.user.xp = req.user.watchMinutes;
  }
  if (body.allAchievements === true) {
    req.user.achievements = ACHIEVEMENTS.map(a=>a.id);
  }
  if (body.minutes != null) {
    const mins = Math.max(0, Math.min(100000, Math.floor(Number(body.minutes))));
    if (!Number.isFinite(mins)) return res.status(400).json({error:"Некорректное количество минут"});
    req.user.watchSeconds = Math.max(Number(req.user.watchSeconds || 0), mins * 60);
    req.user.watchMinutes = Math.max(Number(req.user.watchMinutes || 0), mins);
    req.user.xp = req.user.watchMinutes;
  }
  if (body.achievement) {
    const a = ACHIEVEMENTS.find(x=>x.id===String(body.achievement));
    if (a && !req.user.achievements.includes(a.id)) req.user.achievements.push(a.id);
  }
  if (body.secretBaby === true && !req.user.achievements.includes("baby-unlocked")) req.user.achievements.push("baby-unlocked");
  saveDb();
  res.json({ ok:true, user:publicUser(req.user), creator:true });
});
app.delete("/api/rooms/:code", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  if (room.ownerId !== req.user.id) return res.status(403).json({ error: "Только создатель может удалить комнату" });
  const code = room.code, clients = sseClients.get(code) || new Set();
  for (const resClient of clients) { try { resClient.write(`event: deleted\ndata: ${JSON.stringify({ code })}\n\n`); } catch {} }
  for (const resClient of clients) { try { resClient.end(); } catch {} }
  sseClients.delete(code); presence.delete(code);
  db.rooms = db.rooms.filter(r => r.code !== code);
  db.messages = db.messages.filter(m => m.roomCode !== code);
  saveDb(); res.json({ ok:true, code });
});

app.get("/api/rooms/:code", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  // Opening a shared room link is also an implicit join. This fixes the common
  // case where a user receives /room/ABC123 and clicks it directly.
  if (!isMember(room, req.user.id)) {
    room.members.push(req.user.id);
    ensureUserStats(req.user);
    if (!req.user.achievements.includes("first-room")) req.user.achievements.push("first-room");
    saveDb();
    broadcast(room.code, "room", roomSnapshot(room));
  }
  touchPresence(room.code, req.user);
  res.json({ room: roomSnapshot(room) });
});
app.get("/api/rooms/:code/media", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  if (!isMember(room, req.user.id)) return res.status(403).json({ error: "Нет доступа к комнате" });
  res.json({ media: room.media || null, room: roomSnapshot(room) });
});
app.post("/api/rooms/:code/media", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  if (!isMember(room, req.user.id)) return res.status(403).json({ error: "Нет доступа к комнате" });
  let media;
  try { media = validateVideo(req.body.url); } catch(e) { return res.status(400).json({ error: e.message }); }
  room.media = media; room.playing = false; room.position = 0; room.updatedAt = Date.now(); room.playback = {playing:false, position:0, updatedAt:Date.now(), by:req.user.id, seq:(room.playback?.seq||0)+1, action:"media"};
  saveDb(); const snap = roomSnapshot(room); broadcast(room.code, "room", snap); broadcast(room.code, "media", { media: room.media || null });
  res.json({ room: snap });
});
app.post("/api/rooms/:code/state", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  if (!isMember(room, req.user.id)) return res.status(403).json({ error: "Нет доступа к комнате" });
  const playing = Boolean(req.body.playing);
  const position = Number(req.body.position);
  if (!Number.isFinite(position) || position < 0 || position > 864000) return res.status(400).json({ error: "Некорректная позиция" });
  const now = Date.now();
  room.playing = playing;
  room.position = position;
  room.updatedAt = now;
  const seq = Number(room.playback?.seq || 0) + 1;
  room.playback = { playing, position, updatedAt: now, by: req.user.id, seq, action: String(req.body.action || (playing ? "play" : "pause")) };
  saveDb();
  broadcast(room.code, "state", roomSnapshot(room));
  res.json({ ok: true, state: roomSnapshot(room) });
});

// Message reactions
app.post("/api/rooms/:code/messages/:messageId/reactions", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room || !isMember(room, req.user.id)) return res.status(403).json({ error: "Нет доступа к комнате" });
  const msg = db.messages.find(m => m.id === req.params.messageId && m.roomCode === room.code);
  if (!msg) return res.status(404).json({ error: "Сообщение не найдено" });
  const emoji = String(req.body.emoji || "").trim();
  const allowed = ["❤️","😂","🔥","😮","😭","👏","💀","🍿","👍","👎","🥰","😡"];
  if (!allowed.includes(emoji)) return res.status(400).json({ error: "Недопустимая реакция" });
  if (!msg.reactions) msg.reactions = {};
  if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
  const users = msg.reactions[emoji];
  const i = users.indexOf(req.user.id);
  if (i >= 0) users.splice(i,1); else users.push(req.user.id);
  if (!users.length) delete msg.reactions[emoji];
  saveDb();
  broadcast(room.code, "reaction", { messageId: msg.id, reactions: msg.reactions });
  res.json({ ok:true, reactions: msg.reactions });
});

// SSE
app.get("/api/rooms/:code/events", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).end();
  if (!isMember(room, req.user.id)) return res.status(403).end();
  const code = room.code;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  if (!sseClients.has(code)) sseClients.set(code, new Set());
  sseClients.get(code).add(res);
  touchPresence(code, req.user);
  res.write(`event: room\ndata: ${JSON.stringify(roomSnapshot(room))}\n\n`);
  const ping = setInterval(() => {
    touchPresence(code, req.user);
    res.write(`: ping\n\n`);
    broadcast(code, "presence", roomSnapshot(room).users);
  }, 10000);
  req.on("close", () => {
    clearInterval(ping);
    sseClients.get(code)?.delete(res);
    if (sseClients.get(code)?.size === 0) sseClients.delete(code);
    presence.get(code)?.delete(req.user.id);
    broadcast(code, "presence", roomSnapshot(room).users);
  });
});

// Chat
app.get("/api/rooms/:code/messages", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  if (!isMember(room, req.user.id)) return res.status(403).json({ error: "Нет доступа к комнате" });
  res.json({ messages: db.messages.filter(m => m.roomCode === room.code).slice(-100) });
});
app.post("/api/rooms/:code/messages", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Комната не найдена" });
  if (!isMember(room, req.user.id)) return res.status(403).json({ error: "Нет доступа к комнате" });
  const text = String(req.body.text || "").trim().slice(0, MAX_MESSAGE);
  if (!text) return res.status(400).json({ error: "Пустое сообщение" });
  const msg = { id: id(), roomCode: room.code, userId: req.user.id, nickname: req.user.nickname, text, createdAt: new Date().toISOString(), reactions: {} };
  db.messages.push(msg); db.messages = db.messages.slice(-5000);
  ensureUserStats(req.user);
  const ownMessages = db.messages.filter(m=>m.userId===req.user.id).length;
  if (ownMessages >= 10 && !req.user.achievements.includes("chatty")) req.user.achievements.push("chatty");
  saveDb();
  broadcast(room.code, "message", msg);
  res.status(201).json({ message: msg });
});

// Presence heartbeat
app.post("/api/rooms/:code/heartbeat", requireAuth, (req, res) => {
  const room = findRoom(req.params.code);
  if (!room || !isMember(room, req.user.id)) return res.status(403).json({ error: "Нет доступа" });
  ensureUserStats(req.user);
  const now = Date.now();
  const key = `${room.code}:${req.user.id}`;
  if (!global.__watchTicks) global.__watchTicks = new Map();
  const prev = global.__watchTicks.get(key) || now;
  const elapsed = Math.min(15, Math.max(0, (now - prev) / 1000));
  global.__watchTicks.set(key, now);
  const playing = !!room.playing && !!room.media;
  if (playing && elapsed > 0) {
    req.user.watchSeconds = Number(req.user.watchSeconds || 0) + elapsed;
    req.user.watchMinutes = Math.floor(req.user.watchSeconds / 60);
    req.user.xp = req.user.watchMinutes;
    const unlock = [[60,"first-hour"],[300,"five-hours"],[600,"ten-hours"]];
    for (const [min, aid] of unlock) if (req.user.watchMinutes >= min && !req.user.achievements.includes(aid)) req.user.achievements.push(aid);
    saveDb();
  }
  touchPresence(room.code, req.user);
  res.json({ ok:true, user:publicUser(req.user), watching:playing, state:roomSnapshot(room) });
});

app.get("/api/profile", requireAuth, (req, res) => {
  ensureUserStats(req.user);
  saveDb();
  const stats = {
    ...publicUser(req.user),
    achievements: (req.user.achievements || []).map(id => ACHIEVEMENTS.find(a=>a.id===id)).filter(Boolean),
    availableAchievements: ACHIEVEMENTS
  };
  res.json({ user: stats });
});

app.use("/site-assets", express.static(SITE_MEDIA_DIR, { maxAge: "5m", etag: true }));

// SPA fallback
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const server = app.listen(PORT, HOST, () => {
  console.log(`CheburekWatch listening on ${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  for (const clients of sseClients.values()) {
    for (const res of clients) {
      try { res.end(); } catch {}
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
