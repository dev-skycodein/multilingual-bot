import { test } from "node:test";
import assert from "node:assert/strict";
import { inventedFactProblem } from "../src/guards/facts.ts";
import { handleChat, messageFor } from "../src/chat.ts";
import { fakeLlm, makeDeps } from "./helpers.ts";

// Audit 2026-11-17: "$29 per month ... integrates with Salesforce" passed every runtime guard; the Portuguese password reset
// invented "clique no link 'Esqueci minha senha' na página de login". The assistant has no product data at all.

test("facts guard: prices, plans and trial lengths are caught in every language", () => {
  for (const t of [
    "OpBritops costs $29 per month.",
    "El plan básico cuesta 29 € al mes.",
    "Le forfait coûte 29 euros par mois.",
    "O plano custa 29 reais por mês e 19 USD no plano anual.",
    "Der Preis beträgt 29 Euro pro Monat.",
    "Costa 29 dollari al mese.",
    "Plans start at 15/month.",
    "There is a 14-day free trial.",
    "Hay una prueba gratuita de 14 días con prueba.",
  ]) assert.equal(inventedFactProblem(t), "price", t);
});

test("facts guard: invented step lists are caught (numbered lines, 'Step 1' and its translations)", () => {
  assert.equal(inventedFactProblem("To reset it:\n1. Open the login page\n2. Choose forgot password\n3. Check your email"), "steps");
  assert.equal(inventedFactProblem("Étape 1 : ouvrez la page."), "steps");
  assert.equal(inventedFactProblem("Passo 2: abra a página."), "steps");
  assert.equal(inventedFactProblem("Schritt 1: Öffnen Sie die Seite."), "steps");
});

test("facts guard: invented 'click this button' instructions are caught in the six languages", () => {
  for (const t of [
    "Click the Forgot password link on the login page.",
    "Clique no link 'Esqueci minha senha' na página de login.",
    "Haz clic en el botón de restablecer contraseña.",
    "Cliquez sur « Mot de passe oublié » sur la page de connexion.",
    "Klicken Sie auf den Link „Passwort vergessen“.",
    "Clicca sul pulsante Reimposta password.",
  ]) assert.equal(inventedFactProblem(t), "ui_instruction", t);
});

test("facts guard: integrations with named tools are caught", () => {
  assert.equal(inventedFactProblem("OpBritops integrates with Salesforce and Slack."), "integration");
  assert.equal(inventedFactProblem("Funciona con Shopify y Zapier."), "integration");
  assert.equal(inventedFactProblem("Es compatible con HubSpot."), "integration");
  assert.equal(inventedFactProblem("Funktioniert mit Slack."), "integration");
});

test("facts guard: normal, honest replies pass", () => {
  for (const t of [
    "Hello! I can help with questions about OpBritops. Product details are not available to me yet.",
    "I can help in English, Spanish, French, Portuguese, German and Italian.",
    "Posso aiutarti con domande su OpBritops, per esempio sulle sue funzioni generali.",
    "I can't give you steps for that because I don't have that information yet. Please contact support.",
    "Ich kann Ihnen bei Fragen zu OpBritops helfen. Gibt es etwas Bestimmtes?",
    "Hay 6 idiomas disponibles para conversar.",
    "Merci ! N'hésitez pas à me poser d'autres questions sur OpBritops.",
    "Puedes contactar con una persona del equipo; yo solo puedo explicar lo que hace este asistente.",
  ]) assert.equal(inventedFactProblem(t), undefined, t);
});

test("chat: an invented price is replaced by the fixed 'not available' text in the conversation's language, and never stored", async () => {
  const llm = fakeLlm();
  llm.next = { kind: "text", text: "Posso aiutarti. OpBritops costa 29 dollari al mese." };
  const { deps, logs } = makeDeps(llm);
  const first = await handleChat(deps, { sessionId: undefined, message: "Ciao, quanto costa OpBritops per me?", clientKey: "t" });
  assert.equal(first.body.reply, messageFor("OpBritops", "nodata", "it"));
  assert.ok(logs.includes("invented_facts_blocked"));
  assert.equal(first.body.blocked, true);
  const history = deps.sessions.history(first.body.sessionId!);
  assert.ok(!history.some((t) => t.content.includes("29")), "the invented text must not stay in the history");
});

test("chat: a clean reply is untouched by the facts guard", async () => {
  const llm = fakeLlm();
  const { deps, logs } = makeDeps(llm);
  const r = await handleChat(deps, { sessionId: undefined, message: "Hello, what can you do?", clientKey: "t" });
  assert.equal(r.body.reply, "Hello! I can help with OpBritops.");
  assert.ok(!logs.includes("invented_facts_blocked"));
});
