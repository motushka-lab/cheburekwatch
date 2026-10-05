const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { telegramRequest } = require("./lib/telegram-request");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESSION_DAYS = 30;
const MAX_MESSAGE = 500;
const MAX_NICK = 24;
const VK_API_TOKEN = String(process.env.VK_ACCESS_TOKEN || process.env.VK_USER_TOKEN || "").trim();
const VK_API_VERSION = String(process.env.VK_API_VERSION || "5.199").trim();
const YOUTUBE_API_KEY = String(process.env.YOUTUBE_API_KEY || "").trim();
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_ADMIN_ID = String(process.env.TELEGRAM_ADMIN_ID || "").trim();
const TELEGRAM_BOT_API_BASE = String(process.env.TELEGRAM_BOT_API_BASE || "https://api.telegram.org").replace(/\/$/,"");
const TELEGRAM_OFFICIAL_FILE_LIMIT = 20 * 1024 * 1024;
const TELEGRAM_USING_OFFICIAL = new URL(TELEGRAM_BOT_API_BASE).origin === "https://api.telegram.org";
const TELEGRAM_LOCAL_DIR = path.resolve(process.env.TELEGRAM_LOCAL_DIR || path.join(DATA_DIR, "telegram"));
const TELEGRAM_FILE_TIMEOUT_MS = TELEGRAM_USING_OFFICIAL ? 12000 : 30 * 60 * 1000;
const telegramFileRequests = new Map();

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
if (!Array.isArray(db.animeLibrary)) db.animeLibrary = [];
const sseClients = new Map(); // roomCode -> Set(response)
const presence = new Map();   // roomCode -> Map(userId -> {user, lastSeen})
const vkUserTokens = new Map(); // CheburekWatch userId -> { token, expiresAt } (memory only)

function saveDb() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function normalizeLibraryTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g,"е")
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .trim();
}
function animeLibraryScore(entry, aliases, episode) {
  if (Number(entry?.episode) !== Number(episode)) return -1;
  const key = normalizeLibraryTitle(entry?.title);
  if (!key) return -1;
  let score = 0;
  for (const alias of aliases) {
    const a = normalizeLibraryTitle(alias);
    if (!a) continue;
    if (a === key) score = Math.max(score, 100);
    else if (a.includes(key) || key.includes(a)) score = Math.max(score, 60);
    const at = new Set(a.split(" ").filter(x=>x.length>=3));
    const kt = new Set(key.split(" ").filter(x=>x.length>=3));
    let shared = 0;
    for (const t of at) if (kt.has(t)) shared++;
    score = Math.max(score, shared * 10);
  }
  return score;
}
function findAnimeLibraryEntry(aliases, episode) {
  return db.animeLibrary
    .map(entry=>({entry,score:animeLibraryScore(entry,aliases,episode)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score || String(b.entry.createdAt).localeCompare(String(a.entry.createdAt)))[0]?.entry || null;
}
function upsertAnimeLibraryEntry(entry) {
  const titleKey = normalizeLibraryTitle(entry.title);
  const episode = Number(entry.episode);
  const existingIndex = db.animeLibrary.findIndex(x =>
    normalizeLibraryTitle(x.title) === titleKey && Number(x.episode) === episode
  );
  const item = {
    id: existingIndex >= 0 ? db.animeLibrary[existingIndex].id : id(),
    title: String(entry.title || "").trim().slice(0,160),
    episode,
    kind: entry.kind,
    url: entry.url || null,
    telegramFileId: entry.telegramFileId || null,
    telegramFileUniqueId: entry.telegramFileUniqueId || null,
    localFilePath: entry.localFilePath || null,
    fileSize: Number(entry.fileSize || 0),
    mimeType: String(entry.mimeType || "video/mp4").slice(0,120),
    fileName: String(entry.fileName || "episode.mp4").slice(0,180),
    createdAt: new Date().toISOString()
  };
  if (existingIndex >= 0) db.animeLibrary[existingIndex] = item;
  else db.animeLibrary.push(item);
  saveDb();
  return item;
}
function parseAnimeBotMeta(raw, needsUrl=false) {
  const text = String(raw || "").replace(/^\/add(?:@\w+)?\s*/i,"").trim();
  const parts = text.split("|").map(x=>x.trim()).filter(Boolean);
  if ((needsUrl && parts.length < 3) || (!needsUrl && parts.length < 2)) return null;
  const title = parts[0];
  const episode = Number(parts[1]);
  const url = needsUrl ? parts.slice(2).join("|").trim() : "";
  if (!title || !Number.isFinite(episode) || episode < 1 || episode > 9999) return null;
  return { title, episode:Math.floor(episode), url };
}
async function telegramApi(method, body={}, timeoutMs=35000) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot token is not configured");
  return telegramRequest(`${TELEGRAM_BOT_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/${method}`, body, timeoutMs);
}
async function telegramSay(chatId, text) {
  try {
    await telegramApi("sendMessage", {
      chat_id:chatId,
      text:String(text).slice(0,3900),
      disable_web_page_preview:true
    }, 12000);
  } catch (e) {
    console.warn("Telegram sendMessage failed:", e.message);
  }
}
function telegramIsAdmin(message) {
  return !!TELEGRAM_ADMIN_ID && String(message?.from?.id || "") === TELEGRAM_ADMIN_ID;
}
async function handleTelegramMessage(message) {
  if (!message?.chat?.id || !message?.from?.id) return;
  const chatId = message.chat.id;
  const senderId = String(message.from.id);
  const text = String(message.text || message.caption || "").trim();

  if (/^\/start(?:@\w+)?\b/i.test(text) || /^\/help(?:@\w+)?\b/i.test(text)) {
    const auth = telegramIsAdmin(message);
    const setup = TELEGRAM_ADMIN_ID
      ? (auth ? "Доступ подтверждён." : "Этот аккаунт не назначен администратором библиотеки.")
      : `Сначала добавьте в Render переменную TELEGRAM_ADMIN_ID=${senderId} и перезапустите сервис.`;
    await telegramSay(chatId,
`CheburekWatch Library
Ваш Telegram ID: ${senderId}
${setup}

Как добавлять:
1) Ссылка: Название | номер серии | https://.../episode.mp4
2) Видео/документ: отправьте файл с подписью Название | номер серии
3) /list — последние записи
4) /delete Название | номер серии

${TELEGRAM_USING_OFFICIAL ? "Файлы до 20 МБ. Для больших файлов включите Local Bot API." : "Подключён Local Bot API. Большие файлы сначала скачиваются на сервер; дождитесь сообщения «Сохранено»."}

Используйте только видео и ссылки, которыми вы имеете право делиться.`);
    return;
  }

  if (!TELEGRAM_ADMIN_ID) {
    await telegramSay(chatId, `Библиотека ещё не привязана. Ваш ID: ${senderId}. Добавьте TELEGRAM_ADMIN_ID в Render.`);
    return;
  }
  if (!telegramIsAdmin(message)) {
    await telegramSay(chatId, "Нет доступа к библиотеке.");
    return;
  }

  if (/^\/list(?:@\w+)?\b/i.test(text)) {
    const rows = [...db.animeLibrary].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,30);
    if (!rows.length) return telegramSay(chatId,"Библиотека пока пустая.");
    return telegramSay(chatId, rows.map((x,i)=>`${i+1}. ${x.title} — серия ${x.episode} [${x.kind==="telegram"?"файл":"ссылка"}]`).join("\n"));
  }

  if (/^\/delete(?:@\w+)?\b/i.test(text)) {
    const meta = parseAnimeBotMeta(text.replace(/^\/delete(?:@\w+)?\s*/i,""), false);
    if (!meta) return telegramSay(chatId,"Формат: /delete Название | номер серии");
    const key = normalizeLibraryTitle(meta.title);
    const before = db.animeLibrary.length;
    db.animeLibrary = db.animeLibrary.filter(x => !(normalizeLibraryTitle(x.title)===key && Number(x.episode)===meta.episode));
    if (db.animeLibrary.length !== before) saveDb();
    return telegramSay(chatId, db.animeLibrary.length !== before ? `Удалено: ${meta.title}, серия ${meta.episode}.` : "Такой записи не найдено.");
  }

  const media = message.video || (message.document && (
    String(message.document.mime_type || "").startsWith("video/") ||
    /\.(mp4|webm|ogg)$/i.test(String(message.document.file_name || ""))
  ) ? message.document : null);

  if (media) {
    const meta = parseAnimeBotMeta(message.caption || "", false);
    if (!meta) return telegramSay(chatId,"Подпись к файлу должна быть: Название | номер серии");
    const size = Number(media.file_size || 0);
    if (TELEGRAM_USING_OFFICIAL && size > TELEGRAM_OFFICIAL_FILE_LIMIT) {
      return telegramSay(chatId,
`Файл ${Math.round(size/1024/1024)} МБ слишком большой для обычного Telegram Bot API: он позволяет боту скачать только до 20 МБ. Для полной серии лучше пришлите прямую ссылку на разрешённый видеофайл. Поддержку Local Bot API для больших файлов можно включить отдельно.`);
    }
    const entry = {
      title:meta.title,
      episode:meta.episode,
      kind:"telegram",
      telegramFileId:String(media.file_id || ""),
      telegramFileUniqueId:String(media.file_unique_id || ""),
      fileSize:size,
      mimeType:String(media.mime_type || "video/mp4"),
      fileName:String(media.file_name || `episode-${meta.episode}.mp4`)
    };
    if (!TELEGRAM_USING_OFFICIAL) {
      try {
        if (process.env.TELEGRAM_LOCAL_API === "true") {
          const disk = await fs.promises.statfs(TELEGRAM_LOCAL_DIR);
          const available = Number(disk.bavail) * Number(disk.bsize);
          if (available < size + 256 * 1024 * 1024) {
            return telegramSay(chatId, `Недостаточно места на диске для файла ${Math.ceil(size/1024/1024)} МБ. Освободите место или увеличьте диск Render и отправьте файл повторно.`);
          }
        }
        await telegramSay(chatId, `Получено: ${meta.title} — серия ${meta.episode} (${Math.ceil(size/1024/1024)} МБ). Скачиваю на сервер; дождитесь подтверждения.`);
        const filePath = await resolveTelegramFile(entry);
        if (path.isAbsolute(filePath)) entry.localFilePath = filePath;
      } catch (error) {
        console.warn("Telegram library download failed:", error.name);
        return telegramSay(chatId, "Не удалось подготовить видео. Проверьте Local Bot API и свободное место на диске, затем отправьте файл повторно. Запись не добавлена.");
      }
    }
    const item = upsertAnimeLibraryEntry(entry);
    return telegramSay(chatId,`Сохранено: ${item.title} — серия ${item.episode}. Теперь она доступна на сайте.`);
  }

  const meta = parseAnimeBotMeta(text, true);
  if (meta) {
    try { validateVideo(meta.url); }
    catch(e) { return telegramSay(chatId,`Ссылка не подходит для плеера: ${e.message}`); }
    const item = upsertAnimeLibraryEntry({
      title:meta.title,
      episode:meta.episode,
      kind:"url",
      url:meta.url
    });
    return telegramSay(chatId,`Сохранено: ${item.title} — серия ${item.episode}. Теперь она доступна на сайте.`);
  }

  await telegramSay(chatId,"Не понял запись. Ссылка: Название | серия | URL. Файл: подпись Название | серия. /help — примеры.");
}
let telegramPolling = false;
let telegramUpdateOffset = 0;
async function startTelegramBot() {
  if (!TELEGRAM_BOT_TOKEN || telegramPolling) return;
  telegramPolling = true;
  try {
    const me = await telegramApi("getMe",{},12000);
    console.log(`Telegram library bot ready: @${me?.username || "bot"}`);
  } catch(e) {
    console.warn("Telegram bot could not start:", e.message);
    telegramPolling = false;
    setTimeout(() => startTelegramBot().catch(() => {}), 5000).unref();
    return;
  }
  while (telegramPolling) {
    try {
      const updates = await telegramApi("getUpdates", {
        offset:telegramUpdateOffset,
        timeout:25,
        allowed_updates:["message"]
      }, 35000);
      for (const update of Array.isArray(updates)?updates:[]) {
        telegramUpdateOffset = Math.max(telegramUpdateOffset, Number(update.update_id || 0) + 1);
        try { await handleTelegramMessage(update.message); }
        catch(e) { console.warn("Telegram update failed:", e.message); }
      }
    } catch(e) {
      if (!telegramPolling) break;
      console.warn("Telegram polling:", e.message);
      await new Promise(r=>setTimeout(r,2500));
    }
  }
}
async function checkLocalTelegramFile(filePath) {
  const [root, file] = await Promise.all([
    fs.promises.realpath(TELEGRAM_LOCAL_DIR), fs.promises.realpath(filePath)
  ]);
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Telegram file is outside the configured media directory");
  }
  const stat = await fs.promises.stat(file);
  if (!stat.isFile()) throw new Error("Telegram path is not a media file");
  return file;
}
async function resolveTelegramFile(entry) {
  if (entry.localFilePath) {
    try { return await checkLocalTelegramFile(entry.localFilePath); }
    catch { /* The cache may have been cleared; resolve again through Telegram. */ }
  }
  const key = entry.telegramFileId;
  if (telegramFileRequests.has(key)) return telegramFileRequests.get(key);
  const pending = fetchTelegramFile(entry);
  telegramFileRequests.set(key, pending);
  try { return await pending; }
  finally { telegramFileRequests.delete(key); }
}
async function fetchTelegramFile(entry) {
  const file = await telegramApi("getFile",{file_id:entry.telegramFileId},TELEGRAM_FILE_TIMEOUT_MS);
  const filePath = String(file?.file_path || "");
  if (!filePath) throw new Error("Telegram не вернул путь к файлу");
  if (path.isAbsolute(filePath)) return checkLocalTelegramFile(filePath);
  if (process.env.TELEGRAM_LOCAL_API === "true") throw new Error("Local Bot API did not return a local file");
  return filePath;
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
      const embed = new URL(u.href);
      embed.protocol = "https:";
      embed.hostname = "vkvideo.ru";
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

  if (host === "bilibili.com" || host === "m.bilibili.com" || host === "player.bilibili.com") {
    let episodeId = "";
    let seasonId = "";
    const epMatch = u.pathname.match(/\/bangumi\/play\/ep(\d+)/i);
    const ssMatch = u.pathname.match(/\/bangumi\/play\/ss(\d+)/i);
    if (epMatch) episodeId = epMatch[1];
    if (ssMatch) seasonId = ssMatch[1];
    if (host === "player.bilibili.com") {
      episodeId = u.searchParams.get("episodeId") || u.searchParams.get("ep_id") || episodeId;
      seasonId = u.searchParams.get("seasonId") || u.searchParams.get("season_id") || seasonId;
    }
    if (!/^\d+$/.test(episodeId)) throw new Error("Нужна ссылка на конкретный эпизод Bilibili");
    const embed = new URL("https://player.bilibili.com/player.html");
    if (seasonId) embed.searchParams.set("seasonId", seasonId);
    embed.searchParams.set("episodeId", episodeId);
    embed.searchParams.set("autoplay", "0");
    embed.searchParams.set("danmaku", "0");
    embed.searchParams.set("poster", "1");
    return { type:"bilibili", url:embed.href, sourceUrl:u.href, episodeId, seasonId:seasonId || null };
  }

  if (host === "rutube.ru" || host === "www.rutube.ru") {
    const parts = u.pathname.split("/").filter(Boolean);
    let videoId = "";
    if (parts[0] === "video" || parts[0] === "shorts") videoId = parts[1] || "";
    if (parts[0] === "play" && parts[1] === "embed") videoId = parts[2] || "";
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(videoId)) throw new Error("Не удалось определить RUTUBE video ID");
    return {
      type: "rutube",
      url: `https://rutube.ru/play/embed/${videoId}/`,
      sourceUrl: u.href,
      videoId
    };
  }

  const directExt = /\.(mp4|webm|ogg)(?:$|[?#])/i;
  if (directExt.test(u.pathname + u.search)) {
    return { type: "direct", url: u.href, sourceUrl: u.href };
  }
  throw new Error("Ссылка не поддерживается. Используйте Bilibili, YouTube, VK Video или .mp4/.webm/.ogg");
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
  const currentUser = getUser(req);
  if (currentUser) vkUserTokens.delete(currentUser.id);
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

// VK ID token is received from the official browser SDK, validated once, and kept only in memory.
app.get("/api/vk/status", requireAuth, (req, res) => {
  const saved = vkUserTokens.get(req.user.id);
  if (saved && saved.expiresAt <= Date.now()) vkUserTokens.delete(req.user.id);
  res.json({ connected: !!vkUserTokens.get(req.user.id) || !!VK_API_TOKEN });
});

app.post("/api/vk/connect", requireAuth, async (req, res) => {
  const accessToken = String(req.body?.accessToken || "").trim();
  const expiresIn = Math.max(60, Math.min(86400 * 30, Number(req.body?.expiresIn || 3600)));
  if (accessToken.length < 20 || accessToken.length > 4096) {
    return res.status(400).json({ error: "VK ID не вернул корректный access token" });
  }

  const params = new URLSearchParams({
    access_token: accessToken,
    v: VK_API_VERSION
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://api.vk.com/method/users.get?" + params.toString(), {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    const data = await response.json();
    if (!response.ok || data.error || !Array.isArray(data.response)) {
      return res.status(401).json({
        error: String(data?.error?.error_msg || "Этот токен VK ID не даёт доступ к VK API"),
        code: "VK_TOKEN_REJECTED"
      });
    }
    vkUserTokens.set(req.user.id, {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    });
    res.json({ connected: true });
  } catch (error) {
    res.status(502).json({ error: error?.name === "AbortError" ? "VK не ответил вовремя" : "Не удалось проверить VK ID" });
  } finally {
    clearTimeout(timer);
  }
});

app.post("/api/vk/disconnect", requireAuth, (req, res) => {
  vkUserTokens.delete(req.user.id);
  res.json({ connected: false });
});

// VK Video search. VK's official video.search method requires a user access token.
app.get("/api/vk/search", requireAuth, async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ error: "Введите хотя бы 2 символа" });
  const saved = vkUserTokens.get(req.user.id);
  if (saved && saved.expiresAt <= Date.now()) vkUserTokens.delete(req.user.id);
  const accessToken = (vkUserTokens.get(req.user.id)?.token || VK_API_TOKEN || "").trim();
  if (!accessToken) {
    return res.status(401).json({
      error: "Подключите VK ID, чтобы искать видео.",
      code: "VK_AUTH_REQUIRED"
    });
  }

  const params = new URLSearchParams({
    q,
    sort: "2",
    adult: "0",
    filters: "vk",
    count: "12",
    extended: "0",
    access_token: accessToken,
    v: VK_API_VERSION
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch("https://api.vk.com/method/video.search?" + params.toString(), {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: "VK Video временно недоступен" });
    if (data.error) {
      const msg = String(data.error.error_msg || "VK API вернул ошибку");
      return res.status(502).json({ error: msg, code: "VK_API_ERROR" });
    }

    const rawItems = Array.isArray(data.response?.items) ? data.response.items : [];
    const items = rawItems
      .filter(v => v && v.player && !v.processing && !v.converting && !v.content_restricted)
      .map(v => {
        const images = Array.isArray(v.image) ? [...v.image] : [];
        images.sort((a,b) => Number(b.width || 0) - Number(a.width || 0));
        const thumb = images.find(x => /^https?:\/\//i.test(String(x?.url || "")))?.url || "";
        return {
          id: Number(v.id),
          ownerId: Number(v.owner_id),
          title: String(v.title || "Без названия").slice(0, 180),
          duration: Math.max(0, Number(v.duration || 0)),
          views: Math.max(0, Number(v.views || 0)),
          thumbnail: thumb,
          player: String(v.player),
          type: String(v.type || "video")
        };
      })
      .slice(0, 12);

    res.json({ query: q, count: items.length, items });
  } catch (error) {
    const message = error?.name === "AbortError" ? "VK Video отвечает слишком долго" : "Не удалось выполнить поиск VK Video";
    res.status(502).json({ error: message });
  } finally {
    clearTimeout(timer);
  }
});

// Anime catalogue search via AniList. This returns metadata/official links, not pirated streams.
app.get("/api/anime/search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ error: "Введите хотя бы 2 символа" });

  const query = `query ($search: String) {
    Page(page: 1, perPage: 12) {
      media(search: $search, type: ANIME, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
        id
        title { romaji english native }
        synonyms
        coverImage { extraLarge large color }
        bannerImage
        seasonYear
        format
        episodes
        duration
        genres
        averageScore
        status
        isAdult
        streamingEpisodes { title thumbnail url site }
        externalLinks { site url type }
      }
    }
  }`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query, variables: { search: q } })
    });
    const data = await response.json();
    if (!response.ok || data.errors) {
      return res.status(502).json({ error: String(data?.errors?.[0]?.message || "AniList временно недоступен") });
    }
    const raw = Array.isArray(data.data?.Page?.media) ? data.data.Page.media : [];
    const items = raw.filter(x => x && !x.isAdult).map(x => {
      const title = x.title?.english || x.title?.romaji || x.title?.native || "Без названия";
      const streamLinks = [
        ...(Array.isArray(x.streamingEpisodes) ? x.streamingEpisodes.map(e => ({
          site: String(e.site || "Источник"),
          title: String(e.title || ""),
          url: String(e.url || ""),
          thumbnail: String(e.thumbnail || "")
        })) : []),
        ...(Array.isArray(x.externalLinks) ? x.externalLinks.filter(e => String(e.type || "").toUpperCase() === "STREAMING").map(e => ({
          site: String(e.site || "Источник"),
          title: "",
          url: String(e.url || ""),
          thumbnail: ""
        })) : [])
      ].filter((v,i,a) => /^https?:\/\//i.test(v.url) && a.findIndex(z => z.url === v.url) === i).slice(0, 12);
      return {
        id: Number(x.id),
        title,
        romaji: String(x.title?.romaji || ""),
        native: String(x.title?.native || ""),
        synonyms: Array.isArray(x.synonyms) ? x.synonyms.map(v=>String(v)).filter(Boolean).slice(0,8) : [],
        poster: String(x.coverImage?.extraLarge || x.coverImage?.large || ""),
        banner: String(x.bannerImage || ""),
        color: String(x.coverImage?.color || ""),
        year: Number(x.seasonYear || 0),
        format: String(x.format || ""),
        episodes: Number(x.episodes || 0),
        duration: Number(x.duration || 0),
        genres: Array.isArray(x.genres) ? x.genres.slice(0,4) : [],
        score: Number(x.averageScore || 0),
        status: String(x.status || ""),
        sources: streamLinks
      };
    }).slice(0,12);
    res.json({ query: q, count: items.length, items });
  } catch (error) {
    res.status(502).json({ error: error?.name === "AbortError" ? "AniList отвечает слишком долго" : "Не удалось выполнить поиск аниме" });
  } finally {
    clearTimeout(timer);
  }
});

function rutubeIdFromValue(value) {
  const s = String(value || "");
  const m = s.match(/(?:rutube\.ru\/(?:video|play\/embed)\/)([A-Za-z0-9_-]{16,80})/i);
  return m ? m[1] : "";
}
function normalizeRutubeSearchPayload(data) {
  const raw =
    (Array.isArray(data?.results) && data.results) ||
    (Array.isArray(data?.items) && data.items) ||
    (Array.isArray(data?.data?.results) && data.data.results) ||
    (Array.isArray(data?.data?.items) && data.data.items) ||
    [];
  return raw.map(entry => entry?.object || entry?.video || entry?.content || entry).map(v => {
    const id = String(v?.id || v?.video_id || v?.code || rutubeIdFromValue(v?.url) || rutubeIdFromValue(v?.video_url) || rutubeIdFromValue(v?.embed_url) || "");
    const author = v?.author || v?.owner || {};
    return {
      id,
      title: String(v?.title || v?.name || "Без названия"),
      thumbnail: String(v?.thumbnail_url || v?.picture_url || v?.poster_url || v?.thumbnail || v?.image || ""),
      duration: Math.max(0, Number(v?.duration || v?.duration_seconds || 0)),
      views: Math.max(0, Number(v?.views_count || v?.hits || v?.views || 0)),
      author: String(author?.name || author?.username || v?.feed_name || v?.channel || ""),
      paid: Boolean(v?.is_paid),
      age: Number(v?.pg_rating?.age || v?.age_limit || 0)
    };
  }).filter(v => /^[A-Za-z0-9_-]{16,80}$/.test(v.id) && v.title && !v.paid && (!v.age || v.age < 18));
}
async function fetchRutubeCandidates(query, signal) {
  const urls = [
    "https://rutube.ru/api/search/video/?query=" + encodeURIComponent(query) + "&page=1",
    "https://rutube.ru/api/search/video/?query=" + encodeURIComponent(query) + "&page=1&limit=20"
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal,
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.6",
          "Referer": "https://rutube.ru/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
        }
      });
      if (!response.ok) { lastError = new Error("RUTUBE HTTP " + response.status); continue; }
      const data = await response.json();
      const items = normalizeRutubeSearchPayload(data);
      if (items.length) return items;
    } catch (e) { lastError = e; }
  }
  if (lastError?.name === "AbortError") throw lastError;
  return [];
}
const BILI_MIXIN_KEY_ENC_TAB = [
  46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
  37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52
];
let biliWbiCache = { imgKey:"", subKey:"", expiresAt:0 };

function decodeBasicHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function normalizeSearchTitle(value) {
  return decodeBasicHtml(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function scoreBiliSeason(item, aliases) {
  const title = normalizeSearchTitle(item?.title);
  const original = normalizeSearchTitle(item?.org_title || item?.season_title);
  if (!title && !original) return -999;
  let score = 0;
  for (const alias of aliases) {
    const a = normalizeSearchTitle(alias);
    if (!a) continue;
    if (title === a || original === a) score += 20;
    else if (title.includes(a) || original.includes(a) || a.includes(title)) score += 9;
    const tokens = a.split(" ").filter(x => x.length >= 3);
    for (const token of new Set(tokens)) {
      if (title.includes(token) || original.includes(token)) score += 1.5;
    }
  }
  if (Number(item?.season_type) === 1) score += 4;
  if (Number(item?.season_type) === 4) score += 1;
  return score;
}
async function biliFetchJson(url, signal) {
  const response = await fetch(url, {
    signal,
    headers:{
      "Accept":"application/json, text/plain, */*",
      "Accept-Language":"ru-RU,ru;q=0.8,en;q=0.6",
      "Referer":"https://www.bilibili.com/",
      "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
    }
  });
  if (!response.ok) throw new Error("Bilibili HTTP " + response.status);
  return response.json();
}
async function getBiliWbiKeys(signal) {
  if (biliWbiCache.imgKey && biliWbiCache.expiresAt > Date.now()) return biliWbiCache;
  const data = await biliFetchJson("https://api.bilibili.com/x/web-interface/nav", signal);
  const imgUrl = String(data?.data?.wbi_img?.img_url || "");
  const subUrl = String(data?.data?.wbi_img?.sub_url || "");
  const takeKey = u => u.split("/").pop()?.split(".")[0] || "";
  const imgKey = takeKey(imgUrl), subKey = takeKey(subUrl);
  if (!imgKey || !subKey) throw new Error("Bilibili не выдал ключ поиска");
  biliWbiCache = { imgKey, subKey, expiresAt:Date.now()+45*60*1000 };
  return biliWbiCache;
}
function signBiliWbi(params, imgKey, subKey) {
  const source = imgKey + subKey;
  const mixin = BILI_MIXIN_KEY_ENC_TAB.map(i => source[i] || "").join("").slice(0,32);
  const clean = {};
  for (const [k,v] of Object.entries({...params,wts:Math.floor(Date.now()/1000)})) {
    clean[k] = String(v).replace(/[!'()*]/g,"");
  }
  const query = Object.keys(clean).sort().map(k=>encodeURIComponent(k)+"="+encodeURIComponent(clean[k])).join("&");
  const wRid = crypto.createHash("md5").update(query + mixin).digest("hex");
  return query + "&w_rid=" + wRid;
}
async function searchBiliBangumiOnce(keyword, signal) {
  const baseParams = { search_type:"media_bangumi", keyword, page:"1" };
  const old = new URL("https://api.bilibili.com/x/web-interface/search/type");
  Object.entries(baseParams).forEach(([k,v])=>old.searchParams.set(k,v));
  try {
    const data = await biliFetchJson(old, signal);
    const rows = Array.isArray(data?.data?.result) ? data.data.result : [];
    if (Number(data?.code) === 0 && rows.length) return rows;
  } catch {}
  const keys = await getBiliWbiKeys(signal);
  const signed = signBiliWbi(baseParams, keys.imgKey, keys.subKey);
  const data = await biliFetchJson("https://api.bilibili.com/x/web-interface/wbi/search/type?" + signed, signal);
  return Array.isArray(data?.data?.result) ? data.data.result : [];
}
async function searchBiliBangumi(aliases, signal) {
  const found = new Map();
  for (const alias of aliases.slice(0,5)) {
    let rows = [];
    try { rows = await searchBiliBangumiOnce(alias, signal); } catch {}
    for (const row of rows) {
      const sid = Number(row?.pgc_season_id || row?.season_id || 0);
      if (!sid || found.has(sid)) continue;
      found.set(sid, row);
    }
    if (found.size >= 8) break;
  }
  return [...found.values()]
    .map(item=>({item,score:scoreBiliSeason(item,aliases)}))
    .sort((a,b)=>b.score-a.score);
}
async function getBiliSeason(seasonId, signal) {
  const u = new URL("https://api.bilibili.com/pgc/view/web/season");
  u.searchParams.set("season_id", String(seasonId));
  const data = await biliFetchJson(u, signal);
  if (Number(data?.code) !== 0 || !data?.result) throw new Error(String(data?.message || "Bilibili не вернул сезон"));
  return data.result;
}
function pickBiliEpisode(season, episodeNumber) {
  const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
  if (!episodes.length) return null;
  const n = Number(episodeNumber);
  let ep = episodes.find(x => {
    const t = String(x?.title || "").trim().replace(",",".");
    const num = Number(t);
    return Number.isFinite(num) && Math.abs(num-n) < 0.001;
  });
  if (!ep) ep = episodes[n-1] || null;
  return ep;
}
async function resolveBiliEpisode(aliases, episode, signal) {
  const ranked = await searchBiliBangumi(aliases, signal);
  for (const candidate of ranked.slice(0,5)) {
    if (candidate.score < 3) continue;
    const sid = Number(candidate.item?.pgc_season_id || candidate.item?.season_id || 0);
    if (!sid) continue;
    try {
      const season = await getBiliSeason(sid, signal);
      const ep = pickBiliEpisode(season, episode);
      const epId = Number(ep?.ep_id || ep?.id || 0);
      if (!epId) continue;
      return {
        seasonId:sid,
        episodeId:epId,
        title:String(season?.title || decodeBasicHtml(candidate.item?.title) || aliases[0]),
        episodeTitle:String(ep?.long_title || ep?.title || episode),
        thumbnail:String(ep?.cover || season?.cover || ""),
        regionLimited:Boolean(season?.user_status?.area_limit || ep?.rights?.area_limit),
        badge:String(ep?.badge_info?.text || ep?.badge || ""),
        playerUrl:`https://player.bilibili.com/player.html?seasonId=${sid}&episodeId=${epId}&autoplay=0&danmaku=0&poster=1`,
        pageUrl:`https://www.bilibili.com/bangumi/play/ep${epId}`
      };
    } catch {}
  }
  return null;
}

function parseYouTubeDuration(value) {
  const m = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}
function scoreYouTubeEpisode(item, aliases, episode) {
  const title = String(item.title || "").toLowerCase();
  const channel = String(item.channelTitle || "").toLowerCase();
  const tokens = aliases.flatMap(x => String(x).toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter(x => x.length >= 3);
  let score = 0;
  for (const token of new Set(tokens)) if (title.includes(token)) score += 1.2;
  const n = String(episode);
  const patterns = [
    new RegExp("(?:серия|эпизод|episode|ep\\.?)[^0-9]{0,5}0*" + n + "(?:\\D|$)", "i"),
    new RegExp("(?:^|\\D)0*" + n + "[^0-9]{0,5}(?:серия|эпизод|episode|ep\\.?)", "i"),
    new RegExp("(?:^|\\D)0*" + n + "(?:\\D|$)", "i")
  ];
  if (patterns[0].test(title) || patterns[1].test(title)) score += 10;
  else if (patterns[2].test(title)) score += 3;
  if (item.duration >= 900 && item.duration <= 2400) score += 5;
  else if (item.duration >= 600) score += 2;
  else if (item.duration && item.duration < 240) score -= 6;
  if (/трейлер|тизер|обзор|реакц|нарезк|shorts?|amv|edit|opening|ending|op\b|ed\b/i.test(title)) score -= 8;
  if (/official|официальн/i.test(title + " " + channel)) score += 1.5;
  return score;
}
async function searchYouTubeEpisode(aliases, episode, signal) {
  if (!YOUTUBE_API_KEY) return { configured:false, items:[] };
  const queries = [];
  for (const name of aliases.slice(0,3)) {
    queries.push(`${name} episode ${episode}`);
    queries.push(`${name} серия ${episode}`);
  }
  const collected = new Map();
  for (const q of queries.slice(0,4)) {
    const u = new URL("https://www.googleapis.com/youtube/v3/search");
    u.searchParams.set("part","snippet");
    u.searchParams.set("type","video");
    u.searchParams.set("maxResults","10");
    u.searchParams.set("q",q);
    u.searchParams.set("safeSearch","strict");
    u.searchParams.set("videoEmbeddable","true");
    u.searchParams.set("relevanceLanguage","ru");
    u.searchParams.set("regionCode","RU");
    u.searchParams.set("key",YOUTUBE_API_KEY);
    const response = await fetch(u,{signal,headers:{"Accept":"application/json"}});
    const data = await response.json();
    if (!response.ok || data.error) {
      const msg = data?.error?.message || "YouTube API недоступен";
      const err = new Error(msg);
      err.code = "YOUTUBE_API_ERROR";
      throw err;
    }
    for (const x of (Array.isArray(data.items)?data.items:[])) {
      const id = String(x?.id?.videoId || "");
      if (!id || collected.has(id)) continue;
      collected.set(id,{
        id,
        title:String(x?.snippet?.title || ""),
        channelTitle:String(x?.snippet?.channelTitle || ""),
        thumbnail:String(x?.snippet?.thumbnails?.high?.url || x?.snippet?.thumbnails?.medium?.url || ""),
        duration:0
      });
    }
    if (collected.size >= 18) break;
  }
  const ids=[...collected.keys()].slice(0,20);
  if(ids.length){
    const u=new URL("https://www.googleapis.com/youtube/v3/videos");
    u.searchParams.set("part","contentDetails,status");
    u.searchParams.set("id",ids.join(","));
    u.searchParams.set("key",YOUTUBE_API_KEY);
    const response=await fetch(u,{signal,headers:{"Accept":"application/json"}});
    const data=await response.json();
    if(response.ok && !data.error){
      for(const v of (Array.isArray(data.items)?data.items:[])){
        const item=collected.get(String(v.id||""));
        if(!item)continue;
        item.duration=parseYouTubeDuration(v?.contentDetails?.duration);
        item.embeddable=v?.status?.embeddable!==false;
        item.privacyStatus=String(v?.status?.privacyStatus||"");
      }
    }
  }
  const items=[...collected.values()].filter(x=>x.embeddable!==false && (!x.privacyStatus || x.privacyStatus==="public"));
  return {configured:true,items};
}

function scoreEpisodeCandidate(item, aliases, episode) {
  const title = String(item.title || "").toLowerCase();
  const tokens = aliases.flatMap(x => String(x).toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter(x => x.length >= 3);
  let score = 0;
  for (const token of new Set(tokens)) if (title.includes(token)) score += 1;
  const n = String(episode);
  const epPatterns = [
    new RegExp("(?:серия|эпизод|episode|ep\\.?)[^0-9]{0,5}0*" + n + "(?:\\D|$)", "i"),
    new RegExp("(?:^|\\D)0*" + n + "[^0-9]{0,5}(?:серия|эпизод|episode|ep\\.?)", "i")
  ];
  if (epPatterns.some(r => r.test(title))) score += 9;
  if (item.duration >= 900 && item.duration <= 2400) score += 4;
  else if (item.duration >= 600) score += 2;
  else if (item.duration && item.duration < 240) score -= 5;
  if (/трейлер|тизер|обзор|реакц|нарезк|shorts?|amv|edit/i.test(title)) score -= 7;
  return score;
}

// Best-effort RUTUBE catalogue search. Playback uses RUTUBE's official embed player.
app.get("/api/rutube/search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 140);
  if (q.length < 2) return res.status(400).json({ error: "Введите хотя бы 2 символа" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const items = (await fetchRutubeCandidates(q, controller.signal)).slice(0,12).map(v => ({
      ...v,
      url: `https://rutube.ru/video/${v.id}/`,
      embedUrl: `https://rutube.ru/play/embed/${v.id}/`
    }));
    res.json({ query:q, count:items.length, items });
  } catch(error) {
    res.status(502).json({ error:error?.name==="AbortError"?"Источник отвечает слишком долго":"Не удалось выполнить поиск" });
  } finally { clearTimeout(timer); }
});

// Resolve one anime episode automatically. Provider stays an implementation detail.
app.post("/api/anime/episode-source", requireAuth, async (req, res) => {
  const episode = Math.max(1, Math.min(9999, Math.floor(Number(req.body?.episode || 1))));
  const aliases = [
    String(req.body?.title || "").trim(),
    String(req.body?.romaji || "").trim(),
    String(req.body?.native || "").trim(),
    ...(Array.isArray(req.body?.synonyms) ? req.body.synonyms.map(v=>String(v).trim()) : [])
  ].filter(Boolean).slice(0,10);
  if (!aliases.length) return res.status(400).json({ error:"Не удалось определить название аниме" });

  const entry = findAnimeLibraryEntry(aliases, episode);
  if (!entry) {
    return res.status(404).json({
      error:"Этой серии пока нет в библиотеке. Добавьте её через Telegram-бота.",
      code:"ANIME_LIBRARY_MISSING"
    });
  }

  if (entry.kind === "url") {
    try { validateVideo(entry.url); }
    catch(e) {
      return res.status(410).json({ error:"Ссылка этой серии больше не подходит для плеера. Обновите её через Telegram-бота." });
    }
    return res.json({
      source:{
        type:"library",
        url:entry.url,
        title:`${entry.title} · серия ${episode}`,
        thumbnail:"",
        duration:0
      }
    });
  }

  if (entry.kind === "telegram" && entry.telegramFileId) {
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
    const host = req.get("host");
    const safeName = String(entry.fileName || "episode.mp4").replace(/[^A-Za-z0-9._-]/g,"_");
    const ext = /\.(mp4|webm|ogg)$/i.test(safeName) ? "" : ".mp4";
    return res.json({
      source:{
        type:"library",
        url:`${proto}://${host}/api/library/telegram/${entry.id}/${safeName}${ext}`,
        title:`${entry.title} · серия ${episode}`,
        thumbnail:"",
        duration:0
      }
    });
  }

  return res.status(410).json({ error:"Запись библиотеки повреждена. Перешлите серию боту заново." });
});

app.get("/api/anime/library", requireAuth, (req, res) => {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = req.get("host");
  const items = [...db.animeLibrary].sort((a,b)=>String(a.title||"").localeCompare(String(b.title||""),"ru") || Number(a.episode||0)-Number(b.episode||0)).map(entry=>{
    let url = String(entry.url || "");
    if (entry.kind === "telegram") {
      const safeName = String(entry.fileName || "episode.mp4").replace(/[^A-Za-z0-9._-]/g,"_");
      const ext = /\.(mp4|webm|ogg)$/i.test(safeName) ? "" : ".mp4";
      url = `${proto}://${host}/api/library/telegram/${entry.id}/${safeName}${ext}`;
    }
    return { id:entry.id, title:String(entry.title||""), episode:Number(entry.episode||1), kind:entry.kind==="telegram"?"video":"link", url, fileName:entry.kind==="telegram"?String(entry.fileName||""):"" };
  }).filter(x=>x.url);
  res.json({count:items.length,items});
});

// Secure same-origin proxy: Telegram bot token never reaches the browser.
app.get("/api/library/telegram/:entryId/:name", requireAuth, async (req, res) => {
  const entry = db.animeLibrary.find(x => x.id === req.params.entryId && x.kind === "telegram");
  if (!entry) return res.status(404).end();
  try {
    const filePath = await resolveTelegramFile(entry);
    res.setHeader("Content-Type", entry.mimeType || "video/mp4");
    res.setHeader("Cache-Control","private, max-age=300");
    res.setHeader("Content-Disposition", `inline; filename="episode.mp4"; filename*=UTF-8''${encodeURIComponent(entry.fileName || "episode.mp4").replace(/'/g,"%27")}`);

    if (path.isAbsolute(filePath)) {
      return res.sendFile(filePath, { cacheControl:false }, error => {
        if (!error || res.destroyed) return;
        if (!res.headersSent) res.status(error.statusCode || 502).end();
        else res.destroy();
      });
    }

    const fileUrl = `${TELEGRAM_BOT_API_BASE}/file/bot${TELEGRAM_BOT_TOKEN}/${filePath.replace(/^\/+/, "")}`;
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(fileUrl,{headers});
    if (!upstream.ok && upstream.status !== 206) {
      console.warn("Telegram media upstream:", upstream.status);
      return res.status(502).end();
    }
    res.status(upstream.status);
    for (const h of ["content-length","content-range","accept-ranges","etag","last-modified"]) {
      const value = upstream.headers.get(h);
      if (value) res.setHeader(h, value);
    }
    const reader = upstream.body?.getReader();
    if (!reader) return res.status(502).end();
    req.on("close",()=>{ try{reader.cancel()}catch{} });
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) await new Promise(resolve=>res.once("drain",resolve));
    }
    res.end();
  } catch(e) {
    console.warn("Telegram media proxy failed:", e.message);
    if (!res.headersSent) res.status(502).end();
    else res.end();
  }
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
  let initialMedia = null;
  const initialMediaUrl = String(req.body?.mediaUrl || "").trim();
  if (initialMediaUrl) {
    try { initialMedia = validateVideo(initialMediaUrl); }
    catch(e) { return res.status(400).json({ error: e.message }); }
  }
  const room = {
    code: roomCode(), ownerId: req.user.id, members: [req.user.id], media: initialMedia,
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
  startTelegramBot().catch(e=>console.warn("Telegram bot start failed:",e.message));
});

function shutdown(signal) {
  telegramPolling = false;
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
