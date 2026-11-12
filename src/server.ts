import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { createLlm, keyVariable } from "./llm-factory.ts";
import { SessionStore } from "./sessions.ts";
import { createOutputGuard } from "./guards/output.ts";
import { SlidingWindowLimiter, DailyCap } from "./guards/ratelimit.ts";
import { handleChat, messages } from "./chat.ts";
import type { ChatDeps } from "./chat.ts";

const MAX_BODY_BYTES = 8 * 1024;

const HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { ...HEADERS, "Content-Type": type });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(obj));
}

/** Rejects cross-site browser requests: if an Origin header is sent, its host must match ours. */
function sameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

export function createAppServer(deps: ChatDeps, publicDir: string): http.Server {
  // Only these files are ever served: no path from the request is used to read disk.
  const statics: Record<string, { type: string; body: string }> = {
    "/": { type: "text/html; charset=utf-8", body: readFileSync(path.join(publicDir, "index.html"), "utf8") },
    "/app.js": { type: "text/javascript; charset=utf-8", body: readFileSync(path.join(publicDir, "app.js"), "utf8") },
    "/style.css": { type: "text/css; charset=utf-8", body: readFileSync(path.join(publicDir, "style.css"), "utf8") },
  };
  const msg = messages(deps.config.productName);

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && Object.hasOwn(statics, url.pathname)) {
        const file = statics[url.pathname]!;
        send(res, 200, file.type, file.body);
        return;
      }

      if (url.pathname === "/chat") {
        if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
        if (!sameOrigin(req)) return sendJson(res, 403, { error: "forbidden_origin" });
        if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
          return sendJson(res, 415, { error: "unsupported_media_type" });
        }
        const raw = await readBody(req);
        if (raw === null) return sendJson(res, 413, { error: "payload_too_large" });

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return sendJson(res, 400, { reply: msg.invalid, blocked: true });
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return sendJson(res, 400, { reply: msg.invalid, blocked: true });
        }
        // Only these two fields are read. Anything else the client sends (a
        // "history", "role", "system"...) is ignored.
        const { sessionId, message } = parsed as { sessionId?: unknown; message?: unknown };

        const out = await handleChat(deps, {
          sessionId,
          message,
          clientKey: req.socket.remoteAddress ?? "unknown",
        });
        return sendJson(res, out.status, out.body);
      }

      sendJson(res, 404, { error: "not_found" });
    } catch {
      deps.log("server_error");
      if (!res.headersSent) sendJson(res, 500, { reply: msg.unavailable, blocked: true });
      else res.end();
    }
  });
}

function main(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig();
  if (!process.env[keyVariable(config)]) {
    console.warn(`Warning: ${keyVariable(config)} is not set. The server will start, but model calls will fail until it is.`);
  }

  const canary = `CANARY-${randomUUID()}`;
  const systemPrompt = buildSystemPrompt(config.productName, canary);
  const deps: ChatDeps = {
    config,
    llm: createLlm(config),
    sessions: new SessionStore(config.sessionTtlMs, config.maxSessions, config.maxHistoryMessages),
    outputGuard: createOutputGuard(systemPrompt, canary),
    systemPrompt,
    limiter: new SlidingWindowLimiter(config.ratePerMinute, 60_000),
    daily: new DailyCap(config.dailyRequestCap),
    // Logs carry the event name and small metadata only: never message text, never keys.
    log: (event, details) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...details })),
  };

  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  const server = createAppServer(deps, publicDir);
  server.listen(config.port, config.host, () => {
    console.log(
      `Chat server on http://${config.host}:${config.port}  (${config.provider}: model ${config.model}, classifier ${config.classifierModel})`,
    );
  });
}

if (import.meta.main) main();
