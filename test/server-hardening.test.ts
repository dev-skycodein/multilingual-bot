import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createAppServer, clientIp } from "../src/server.ts";
import { fakeLlm, makeDeps } from "./helpers.ts";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const { deps } = makeDeps(fakeLlm());
let server: http.Server;
let port = 0;

before(async () => {
  server = createAppServer(deps, publicDir);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

/** Raw request, so we see exactly what the server sends (including a cut connection). */
function raw(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number } | { error: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: opts.path ?? "/chat", method: opts.method ?? "POST", headers: opts.headers ?? {} },
      (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode ?? 0 })); },
    );
    req.on("error", (e: NodeJS.ErrnoException) => resolve({ error: e.code ?? e.message }));
    req.end(opts.body);
  });
}

test("oversized body gets a real HTTP 413 answer, not a dropped connection", async () => {
  const r = await raw({ headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "a".repeat(20_000) }) });
  assert.deepEqual(r, { status: 413 });
});

test("content-type must be exactly application/json (charset allowed, look-alikes rejected)", async () => {
  const body = JSON.stringify({ message: "Hello" });
  assert.deepEqual(await raw({ headers: { "Content-Type": "application/json; charset=utf-8" }, body }), { status: 200 });
  assert.deepEqual(await raw({ headers: { "Content-Type": "APPLICATION/JSON" }, body }), { status: 200 });
  assert.deepEqual(await raw({ headers: { "Content-Type": "application/jsonx" }, body }), { status: 415 });
  assert.deepEqual(await raw({ headers: { "Content-Type": "application/json-evil" }, body }), { status: 415 });
});

test("Host header must match the allow-list (blocks DNS-rebinding pages on a local server)", async () => {
  const body = JSON.stringify({ message: "Hello" });
  const evil = `evil.example:${port}`;
  assert.deepEqual(await raw({ headers: { "Content-Type": "application/json", Host: evil, Origin: `http://${evil}` }, body }), { status: 403 });
  assert.deepEqual(await raw({ method: "GET", path: "/", headers: { Host: evil } }), { status: 403 });
  assert.deepEqual(await raw({ headers: { "Content-Type": "application/json", Host: `localhost:${port}` }, body }), { status: 200 });
  assert.deepEqual(await raw({ headers: { "Content-Type": "application/json" }, body }), { status: 200 }, "127.0.0.1 itself is allowed");
});

test("served page marks chat bubbles dir=auto so right-to-left text lays out correctly", async () => {
  const js = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  assert.match(js, /dir\s*=\s*"auto"/);
});

test("clientIp: ignores X-Forwarded-For unless hops are configured, then takes the Nth from the right", () => {
  const req = (xff: string | undefined, addr = "10.0.0.1") => ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: addr } });
  assert.equal(clientIp(req("9.9.9.9, 1.2.3.4"), 0), "10.0.0.1", "header is ignored by default");
  assert.equal(clientIp(req("9.9.9.9, 1.2.3.4"), 1), "1.2.3.4", "one trusted proxy: the address it saw");
  assert.equal(clientIp(req("spoofed, 9.9.9.9, 1.2.3.4"), 2), "9.9.9.9");
  assert.equal(clientIp(req(undefined), 1), "10.0.0.1", "no header: fall back to the socket");
  assert.equal(clientIp(req("1.2.3.4"), 3), "10.0.0.1", "fewer hops than configured: fall back to the socket");
  assert.equal(clientIp({ headers: {}, socket: {} }, 0), "unknown");
});
