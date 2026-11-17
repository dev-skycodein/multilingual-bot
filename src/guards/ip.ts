// How a client address becomes a rate-limit key.

/**
 * One key per network, not per address. An IPv6 user normally owns a whole /64, so keying on the full address would let
 * one person mint billions of "different clients" and walk around every per-client limit. IPv4-mapped IPv6
 * ("::ffff:1.2.3.4") is the same client as plain IPv4. Anything that does not parse is returned unchanged.
 */
export function normalizeIp(addr: string): string {
  let a = addr.trim().toLowerCase();
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return mapped[1]!;
  if (!a.includes(":")) return a;
  const groups = expandV6(a);
  return groups ? `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64` : a;
}

function expandV6(a: string): number[] | undefined {
  if (!/^[0-9a-f:.]+$/.test(a)) return undefined;
  // A trailing dotted IPv4 part ("64:ff9b::1.2.3.4") is two groups.
  const v4 = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [, head, b1, b2, b3, b4] = v4;
    a = `${head}${((+b1! << 8) | +b2!).toString(16)}:${((+b3! << 8) | +b4!).toString(16)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return undefined;
  const parse = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const nums = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : undefined;
}

/** True for loopback, private and link-local addresses: the kind a reverse proxy on the same machine or network has. */
export function isPrivateAddress(addr: string): boolean {
  const a = normalizeIp(addr);
  if (a === "::1/64" || a === "0:0:0:0::/64") return true; // ::1
  if (/^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)) return true; // fc00::/7, fe80::/10
  const m = /^(\d{1,3})\.(\d{1,3})\./.exec(a);
  if (!m) return false;
  const [x, y] = [+m[1]!, +m[2]!];
  return x === 127 || x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254);
}
