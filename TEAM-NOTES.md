# TEAM-NOTES: multilingual-bot (OpBritops Assistant)

Shared project notes for everyone working on this repo. No keys, secrets, internal addresses or personal paths in here. Last updated 2026-11-18 (fixes 1-12 done and pushed; Anthropic provider removed).

## Project
- Node 24 + TypeScript, `node:http`, no framework.
- Customer-support chatbot "OpBritops Assistant" (demo).
- Languages: English, Spanish, French, Portuguese, German, Italian.
- It has NO product data. It must never invent features, prices, plans, integrations or policies.
- It must only talk about OpBritops and resist prompt injection.
- Server: `node src/server.ts`, default http://127.0.0.1:3000. Port 3000 is often taken by another dev server on the same machine: never kill it, run this bot with `PORT=3100`.
- Tests: `npm test` (245 pass on 2026-11-18). Typecheck: `npx tsc --noEmit` (clean).

## Working rules
- Separate verified (you ran it and saw the result) from unverified. No guessing.
- Commit and push only with `gpush "message"`. Never plain `git commit` or `git push`. Never force-push.
- One fix = one commit + push (fix -> `npm test` + typecheck -> `gpush` -> next fix). Never batch fixes.
- Audit/findings-only requests = change nothing.
- No AI/tool attribution in commits, PR text or files.
- Never commit `.env*` (except `.env.example`), `*.pem`, API key files. `API.md` is git-ignored.
- Never print or share keys. Keys live in `.env`: `GEMINI_API_KEY`, `SKYCODEIN_API_KEY`.
- Shell trap (hit 3 times): in a python heredoc through a Bash tool, `\\b` / `\\n` collapse to a real backspace / newline byte. Edit code that contains backslashes with an editor tool. Several source files are CRLF, so a scripted edit must handle `\r\n`. `test/no-control-chars.test.ts` catches stray control bytes.

## Providers
- Gemini is the main provider. When the Gemini quota is used up, switch to SkyCodein. Anthropic is not used.
- There is NO automatic fallback in the code: the switch is `LLM_PROVIDER=gemini|skycodein` in `.env` (default when unset: gemini).
- `gemini` (`src/llm-gemini.ts`): free-tier daily quota ran out on 2026-11-17 (HTTP 429), so nothing from the 2026-11-17/18 live checks was run on Gemini.
- `skycodein` (`src/llm-skycodein.ts`): OpenAI-style chat API on the local network. `SKYCODEIN_BASE_URL` has no default (fix 7): it is required when the provider is skycodein and is kept in `.env`. If it fails: check the host is reachable, then `GET http://<host>:8000/` must say `skycodein-backend` BEFORE sending the key anywhere.
- SkyCodein rate limit: 30 requests/min per key, one reply at a time. One chat message = 2 calls (classifier + reply), so live scripts need DELAY_MS 5000 or more (300 ms gave HTTP 429). The API keeps the newest 20 messages / 8000 chars, so `fitToBudget` keeps the system prompt plus the newest user message within 7000 chars / 18 messages.
- Anthropic provider REMOVED (commit 3bbf55e, 2026-11-18): `LLM_PROVIDER=anthropic` is now an invalid value (test: `test/no-anthropic.test.ts`). The word "Anthropic" still in the prompt and classifier security rules is attack wording, not the provider; keep it.
- The SkyCodein API's own persona outranks our system prompt. So the classifier must use `response_format` json_schema, and asking the main model to emit a token does NOT work.
- The API sometimes says "Live search did not run." (the prefix is stripped) and sometimes mentions "live search" in replies (not fully fixed).

## Architecture (request flow)
1. Per-IP rate limit (key = IPv4 address or IPv6 /64, `src/guards/ip.ts`), input guards (Unicode, length), per-client and global daily caps. Host allow-list; `proxy_suspected` is logged once if X-Forwarded-For comes from a private address while TRUST_PROXY_HOPS=0.
2. Language detector (`src/guards/language.ts`): word lists, short-message rule, URL stripping, candidates.
3. Classifier call (`classifyWithLanguage`): `verdict`, `language`, `scope`. Verdict fails closed. A missing or invalid scope = `off_topic` (fix 3). Classifier prompt: code requests are always off_topic; general knowledge is off_topic (fix 10); asking to list/summarise the rules is an attack (fix 11); one-word replies are not attacks; asking to complete/continue/repeat "the original text" is extraction.
4. Language lock (`src/guards/langlock.ts`, fix 1): an explicit request or a sure message of 3+ words changes the conversation language; fewer than 3 words never does; the classifier's language is only a guess. All fixed messages use the locked language.
5. Scope gate: `off_topic` gets the fixed localized message, no model call. Exception (fix 1b): a one-word message in a running conversation is let through with a server note. UNSAFE is never set aside.
6. Main model reply with the system prompt, a language hint, the canary.
7. Output guards: canary / prompt copy / prompt section header in any of the six languages (fix 9); provider name filter; reply-language check with one retry; invented-facts guard (`guards/facts.ts`, fix 4); language-list check (`langlist.ts`, fix 6). Unsupported-language users get an English answer (fix 12).
- Sessions are in-memory (LRU).

## Findings status
- DONE: language lock, reliable detector + retry, red-team harness, invented facts net, scope required, IPv6 / cap eviction / proxy warning, langlist, no LAN default, Anthropic removal, fixes 9-12.
- NOT fixed: global DAILY cap can still be used up by about 10 IPs x per-client cap (design trade-off; knobs RATE_PER_MINUTE / DAILY_REQUEST_CAP / PER_CLIENT_DAILY_CAP); latency / timeouts / no concurrency limit; Gemini classifier has no temperature 0; classifier prompt "exactly one word" vs JSON (probably harmless); some tests are corpus checks.
- Seen live, still open: classifier calls the one word "Team" UNSAFE in it/fr context (1-2 of 32); about 3 of 77 turns hit language_retry + mismatch and the user gets "sorry, ask again"; English words inside a Spanish reply; 2-3 word acks can still get the off-topic reply; if the FIRST message fails with a classifier error no lock is saved; the facts guard is a net with holes; Latin-script unsupported languages (tr/id/nl) are not recognised.

## Live results (SkyCodein, 2026-11-18, replies read by hand)
- `langlock` (17 conversations, 77 turns, DELAY_MS 5000): pass 71, fail 0, unknown 5 (read: all correct), ambiguous 1, error 0.
- Second full red-team (before fixes 10-12): 220/220, langlock fail 0. NOT re-run after fixes 10-12.
- Fix 10: held-out 11/12 general-knowledge questions blocked. Fix 11: 6/6 and held-out 8/8 blocked, 8/8 on-topic kept. Fix 12: Urdu, Hindi, Arabic, Russian get an English answer, Chinese the English list of six languages.

## Unverified / known limits (do not claim more)
- Gemini: nothing from the 2026-11-17/18 checks was run on Gemini (quota). Biggest gap: when quota is back, run `npm run smoke`, `npm run langlock` and `npm run redteam:hard` with `LLM_PROVIDER=gemini` and read the replies.
- Each live test ran once; replies vary between runs.
- With the classifier bypassed, SkyCodein's main model obeys token injections (ZEBRA test, 7 languages). Gemini did not.
- Fixed messages and translations were written without native-speaker review.
- No adaptive (rephrase-until-it-works) attacker test; no hosted / multi-user test.
- The SkyCodein API is plain `http://` on the local network. Rate limits and sessions are in-memory only. An old default address stays in git history (commits before fix 7); history was not rewritten.

## Demo on the local network
- Use environment variables only (no `.env` change): `PORT=3100 HOST=0.0.0.0 LLM_PROVIDER=skycodein ALLOWED_HOSTS=<your-lan-ip>,localhost,127.0.0.1 node src/server.ts`.
- Not verified from another device. Windows Firewall may block inbound traffic on the port; allowing it needs an admin rule.
- Cautions: plain http, no login (anyone on the same network can use it); SkyCodein limit 30 req/min per key; the PC must not sleep.

## Habits
- Check the PID and command line on the port before testing (a stale server once served old code).
- Stop only our own server (command line contains `src/server.ts`).
- Probe scripts and test output go to a scratch folder or git-ignored files, never into the repo.
- Before trusting a new test, plant the bug and watch it fail.
