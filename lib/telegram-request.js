"use strict";

const http = require("node:http");
const https = require("node:https");

// Native HTTP has no fetch/Undici five-minute header deadline. A large local
// getFile request can legitimately wait while Telegram downloads a whole episode.
function telegramRequest(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
    }, response => {
      const chunks = [];
      let length = 0;
      response.on("data", chunk => {
        length += chunk.length;
        if (length > 4 * 1024 * 1024) {
          request.destroy(new Error("Telegram response too large"));
          response.destroy();
        } else chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (response.statusCode < 200 || response.statusCode >= 300 || !data.ok) {
            throw new Error(String(data.description || "Telegram request failed"));
          }
          resolve(data.result);
        } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error("Telegram request timed out")), timeoutMs);
    request.once("error", reject);
    request.once("close", () => clearTimeout(timer));
    request.end(payload);
  });
}

module.exports = { telegramRequest };
