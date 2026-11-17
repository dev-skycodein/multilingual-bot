import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeIp, isPrivateAddress } from "../src/guards/ip.ts";
import { KeyedDailyCap } from "../src/guards/ratelimit.ts";
import { clientIp, proxySuspected, createAppServer } from "../src/server.ts";
import { fakeLlm, makeDeps } from "./helpers.ts";

// Audit 2026-11-17 (availability): 50k distinct keys (IPv6) made every new client refused for the day; behind a proxy with
// TRUST_PROXY_HOPS=0 every user shares one key (15 messages a minute for ALL).

test("normalizeIp: every address of one IPv6 /64 is one client; IPv4 and IPv4-mapped are the same client", () => {
  assert.equal(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(normalizeIp("2001:DB8:1:2::1"), "2001:db8:1:2::/64");
  assert.equal(normalizeIp("2001:db8:1:2:1:2:3:4"), normalizeIp("2001:db8:1:2:ffff:ffff:ffff:ffff"));
  assert.notEqual(normalizeIp("2001:db8:1:2::1"), normalizeIp("2001:db8:1:3::1"));
  assert.equal(normalizeIp("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(normalizeIp("1.2.3.4"), "1.2.3.4");
  assert.equal(normalizeIp("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(normalizeIp("::1"), "0:0:0:0::/64");
  assert.equal(normalizeIp("not an address"), "not an address");
  assert.equal(normalizeIp("1:2:3"), "1:2:3", "malformed v6 is left as it is");
});

test("clientIp: IPv6 sockets and forwarded addresses are keyed per /64", () => {
  const req = (xff: string | undefined, addr: string) => ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: addr } });
  assert.equal(clientIp(req(undefined, "2001:db8:5:6:1:2:3:4"), 0), "2001:db8:5:6::/64");
  assert.equal(clientIp(req("2001:db8:5:6:9:9:9:9", "10.0.0.1"), 1), "2001:db8:5:6::/64");
  assert.equal(clientIp(req(undefined, "::ffff:9.9.9.9"), 0), "9.9.9.9");
});

test("isPrivateAddress / proxySuspected: a forwarded header from a private address with hops=0 is flagged", () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "192.168.18.5", "172.16.0.9", "172.31.255.1", "::1", "::ffff:10.0.0.1", "fd12:3456::1", "fe80::1"]) assert.ok(isPrivateAddress(a), a);
  for (const a of ["8.8.8.8", "172.32.0.1", "2001:db8::1", "11.0.0.1"]) assert.ok(!isPrivateAddress(a), a);
  const req = (xff: string | undefined, addr: string) => ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: addr } });
  assert.ok(proxySuspected(req("1.2.3.4", "127.0.0.1"), 0));
  assert.ok(!proxySuspected(req("1.2.3.4", "127.0.0.1"), 1), "hops configured: fine");
  assert.ok(!proxySuspected(req(undefined, "127.0.0.1"), 0), "no header: not a proxy");
  assert.ok(!proxySuspected(req("1.2.3.4", "8.8.8.8"), 0), "a public client sending the header itself is not a proxy");
});

test("server: logs proxy_suspected once, not on every request", async () => {
  const { deps, logs } = makeDeps(fakeLlm());
  const server = createAppServer(deps, path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const post = () => new Promise<void>((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/chat", method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "8.8.4.4" } }, (res) => { res.resume(); res.on("end", () => resolve()); });
    req.end(JSON.stringify({ message: "Hello" }));
  });
  await post();
  await post();
  server.close();
  assert.equal(logs.filter((l) => l === "proxy_suspected").length, 1);
});

test("KeyedDailyCap: when the table is full the oldest client is forgotten and NEW clients are still served", () => {
  const c = new KeyedDailyCap(2, () => 0, 3);
  for (const k of ["a", "b", "c"]) assert.ok(c.allow(k));
  assert.ok(c.allow("d"), "a new client must not be refused just because the table is full");
  assert.ok(c.allow("d"));
  assert.ok(!c.allow("d"), "its own cap still applies");
  assert.ok(c.allow("b") && c.allow("c"), "clients that were not evicted keep their counts");
});

test("KeyedDailyCap: a flood of distinct keys cannot grow the table past its bound", () => {
  const c = new KeyedDailyCap(1, () => 0, 100);
  for (let i = 0; i < 10_000; i++) c.allow(`k${i}`);
  assert.ok(((c as unknown) as { counts: Map<string, number> }).counts.size <= 100);
});
