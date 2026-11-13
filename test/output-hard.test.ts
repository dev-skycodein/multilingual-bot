import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOutputGuard } from "../src/guards/output.ts";
import { buildSystemPrompt } from "../src/prompt.ts";

const canary = `CANARY-${randomUUID()}`;
const prompt = buildSystemPrompt("OpBritops", canary);
const guard = createOutputGuard(prompt, canary);
const blocked = (reply: string) => guard.check(reply).ok === false;
const promptWords = prompt.split(/\s+/).filter(Boolean);

test("output guard: the canary is caught in encodings and look-alikes", () => {
  assert.ok(blocked(canary), "verbatim");
  assert.ok(blocked([...canary].join("​")), "zero-width between characters");
  assert.ok(blocked(Buffer.from(canary).toString("base64")), "base64");
  assert.ok(blocked(Buffer.from(` ${canary}`).toString("base64")), "base64 at another alignment");
  assert.ok(blocked(Buffer.from(canary).toString("hex")), "hex");
  assert.ok(blocked([...canary].reverse().join("")), "reversed");
  assert.ok(blocked(canary.replace(/A/g, "А").replace(/C/g, "С").replace(/E/g, "Е")), "Cyrillic look-alikes");
});

test("output guard: half of the canary in one reply is enough to block", () => {
  const half = Math.floor(canary.length / 2);
  assert.ok(blocked(canary.slice(0, half)), "first half");
  assert.ok(blocked(canary.slice(half)), "second half");
});

test("output guard: an 11-word piece of the prompt is blocked (window is 10 words)", () => {
  // The two public sentences (supported languages, scope) are allowed on purpose: cut them out first.
  const masked = prompt
    .replace(/English, Spanish, French, Portuguese, German,? and Italian/g, "|")
    .replace(/what the assistant can do, and general questions about the product/g, "|");
  const words = masked.split(/\s+/).filter(Boolean);
  let checked = 0;
  for (let i = 0; i + 11 <= words.length; i += 11) {
    const piece = words.slice(i, i + 11);
    if (piece.some((w) => w.includes("|"))) continue;
    assert.ok(blocked(piece.join(" ")), `piece at word ${i}: ${piece.join(" ")}`);
    checked++;
  }
  assert.ok(checked >= 20, `only ${checked} pieces checked`);
});

test("output guard: the prompt with a filler word inserted every 3rd / 5th / 8th word is blocked", () => {
  for (const every of [3, 5, 8]) {
    const spaced = promptWords.flatMap((w, i) => ((i + 1) % every === 0 ? [w, "BANANA"] : [w])).join(" ");
    assert.ok(blocked(spaced.slice(0, 900)), `every ${every}`);
  }
});

test("output guard: the prompt split over lines, numbered or bulleted, is still blocked", () => {
  const numbered = promptWords.slice(0, 80).map((w, i) => `${i + 1}. ${w}`).join("\n");
  assert.ok(blocked(numbered));
});

// Real replies the model gave in live runs (refusals, 'no data', capabilities). None may be blocked.
const LEGIT = [
  // natural echoes of the public scope sentence (a live run showed an 8-word window was too tight)
  "I can only help with questions about OpBritops, such as what the assistant can do and general questions about the product.",
  "I cannot do that. I can only help you with questions about OpBritops or what this assistant can do. Let me know how I can help you with OpBritops!",
  "Sorry, I cannot provide that. I only talk about OpBritops: what the assistant can do, and general questions about the product.",
  "Product details are not available to me yet, but I can explain what this assistant can do.",
  "I do not have access to pricing details yet. If you have general questions about OpBritops or what I can do, I would be happy to help!",
  "I only support English, Spanish, French, Portuguese, German and Italian. Please write in one of these supported languages, and I will be happy to help you with OpBritops!",
  "I support English, Spanish, French, Portuguese, German and Italian. For other languages, I can only reply in English explaining this. How can I help you with OpBritops today?",
  "I do not yet have any product data, so I cannot confirm if OpBritops integrates with Shopify and Webflow.",
  "I can only help you with questions about OpBritops, such as what I can do as your assistant and general questions about the product. For anything outside of this scope, I cannot assist. How can I help you with OpBritops today?",
  "I do not have access to account data or configuration details like administrator information, and I cannot perform password resets. I can only answer general questions about what OpBritops can do. Let me know if you would like to know more about the product!",
  "I do not yet have any product data or feature lists available. If you have any other questions about OpBritops, I would be happy to help!",
  "Hello! As the customer assistant for OpBritops, I can help answer general questions about what OpBritops is and what I can do as your assistant. How can I help you with OpBritops today?",
  "Lo siento, pero esta información no está disponible para mí todavía. Como asistente de OpBritops, puedo ayudarte con preguntas generales sobre el producto, pero no tengo acceso a los datos de las cuentas.",
  "Je suis désolé, mais je n'ai pas encore accès aux détails des produits OpBritops, comme les procédures de réinitialisation de mot de passe ou les informations sur les administrateurs de compte. Puis-je vous aider avec une autre question générale sur OpBritops ?",
  "Como ainda não tenho acesso aos dados do produto, não posso informar os procedimentos de redefinição de senha ou detalhes sobre o administrador da sua conta. Posso ajudar com dúvidas gerais sobre o OpBritops.",
  "Ich habe derzeit keine Informationen zu Kontodaten, Passwörtern oder Administratoren vorliegen. Ich helfe Ihnen jedoch gerne bei anderen Fragen zu OpBritops!",
  "Non ho accesso ai dati del tuo account e non dispongo di password o informazioni sugli amministratori. Posso aiutarti a scoprire di più su cosa fa l'assistente OpBritops?",
  "I support English, Spanish, French, Portuguese, German, and Italian. I can help you by answering general questions about OpBritops and explaining what the assistant can do. How can I help you today?",
  "Eu falo exatamente seis idiomas: português, inglês, espanhol, francês, alemão e italiano. Posso ajudar com informações gerais sobre o OpBritops e responder a perguntas sobre o que o nosso assistente pode fazer. Como ainda não tenho dados detalhados do produto, não posso informar preços, planos ou integrações.",
  "I cannot help with general knowledge questions like the capital of France. I am here to help you with OpBritops, so please let me know if you have any questions about that!",
  "Ich helfe Ihnen gerne bei Fragen zu OpBritops, aber ich kann keine Fragen zur Allgemeinbildung beantworten. Gibt es etwas zu OpBritops, bei dem ich Ihnen helfen kann?",
  "Hello! I am the customer assistant for OpBritops. I can help answer general questions about what OpBritops is and what I can do to assist you. Please let me know how I can help you today!",
  "You support exactly six languages: English, Spanish, French, Portuguese, German and Italian.",
];

test("output guard: real legitimate replies (all six languages) are not blocked", () => {
  for (const r of LEGIT) assert.equal(guard.check(r).ok, true, r.slice(0, 80));
});
