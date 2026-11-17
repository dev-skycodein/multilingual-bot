// The assistant has NO product data. The prompt says "never invent features, prices, plans, integrations, policies or
// steps", but a weak model does it anyway (live: "$29 per month ... integrates with Salesforce"; a Portuguese password
// reset with invented "clique no link 'Esqueci minha senha'" steps). This guard looks at the reply and catches the
// shapes that can only be invented here. It is a net with holes, not a proof: it cannot recognise every invented fact.
// A false alarm is cheap: the user gets "product details are not available yet", which is true anyway.

export type FactProblem = "price" | "steps" | "ui_instruction" | "integration";

// JavaScript's \b only knows ASCII letters ("É" or "ç" at a word edge breaks it), so word edges are lookarounds.
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;
const word = (alternatives: string) => `${START}(?:${alternatives})${END}`;

const CURRENCY_WORDS =
  "usd|eur|gbp|brl|chf|dollars?|dollari|dollaro|dólares?|dólar|euros?|pounds?|libras?|livres?|reais|reales|pesos?|franken|francs?|franchi";
const MONEY = new RegExp(String.raw`[$€£]\s?\d|\d\s?[$€£]|${START}\d[\d.,]*\s?(?:${CURRENCY_WORDS})${END}`, "iu");
const PERIODS = "month|year|mo|yr|mes|año|mois|an|mês|ano|monat|jahr|mese|anno";
const PER_PERIOD = new RegExp(String.raw`${START}\d[\d.,]*\s?(?:/|per|por|par|pro|al|a|au|à|im)\s?(?:${PERIODS})${END}`, "iu");
const TRIAL_UNITS = "day|days|día|días|jour|jours|dia|dias|tag|tage|giorno|giorni";
const TRIAL_WORDS = "trial|prueba|essai|teste|testversion|prova|gratis|gratuit\\w*|gratuita|free";
const FREE_TRIAL_DAYS = new RegExp(
  String.raw`${START}\d{1,3}[-\s]?(?:${TRIAL_UNITS})${END}[^.\n]{0,25}${START}(?:${TRIAL_WORDS})${END}|${START}(?:${TRIAL_WORDS})${END}[^.\n]{0,25}${START}\d{1,3}[-\s]?(?:${TRIAL_UNITS})${END}`,
  "iu",
);

// Two or more numbered lines, or "Step 1" in any of the six languages.
const NUMBERED_LINE = /^\s*(?:\d{1,2}[.)]|[-•*]\s*\d{1,2}[.)])\s+\S/gmu;
const STEP_WORD = new RegExp(`${START}(?:step|paso|étape|etape|passo|schritt|passaggio)\\s*\\d`, "iu");

const CLICK_VERB =
  "click|tap|press|select|choose|clique|cliquez|haz\\s+clic|hacer\\s+clic|pulsa|pulse|presiona|presione|selecciona|seleccione|appuyez|sélectionnez|selectionnez|clicca|premi|seleziona|klicke|klicken|drücke|drücken|wähle|wählen|toque|selecione|pressione|escolha";
const UI_NOUN =
  "link|button|botón|boton|bouton|botão|botao|pulsante|schaltfläche|schaltflaeche|enlace|lien|menu|menú|menü|menù|settings|configuración|configuraciones|paramètres|parametres|configurações|configuracoes|einstellungen|impostazioni|página|pagina|page|seite|login|connexion|anmeldung|accesso";
const UI_INSTRUCTION = new RegExp(`${word(CLICK_VERB)}[^.\\n]{0,40}(?:${word(UI_NOUN)}|["'“”„‘’«»])`, "iu");

const NAMED_TOOLS =
  "Salesforce|HubSpot|Slack|Shopify|Zapier|Stripe|Zendesk|WhatsApp|Webflow|Notion|Google|Microsoft|Teams|Jira|Mailchimp|Intercom|Twilio|PayPal|Excel";
const INTEGRATION_VERB =
  "integrat\\w*|integr\\w*|compatible|works?\\s+with|connects?\\s+(?:to|with)|funciona\\s+con|fonctionne\\s+avec|funciona\\s+com|funktioniert\\s+mit|funziona\\s+con|se\\s+conecta\\s+con|se\\s+connecte\\s+à|conecta-se\\s+com|verbindet\\s+sich\\s+mit|si\\s+collega\\s+a";
const INTEGRATION = new RegExp(`${START}(?:${INTEGRATION_VERB})${END}[^.\\n]{0,60}${word(NAMED_TOOLS)}`, "iu");

/** The kind of invented fact this reply contains, or undefined when it has none of the recognised shapes. */
export function inventedFactProblem(reply: string): FactProblem | undefined {
  if (MONEY.test(reply) || PER_PERIOD.test(reply) || FREE_TRIAL_DAYS.test(reply)) return "price";
  if ((reply.match(NUMBERED_LINE)?.length ?? 0) >= 2 || STEP_WORD.test(reply)) return "steps";
  if (UI_INSTRUCTION.test(reply)) return "ui_instruction";
  if (INTEGRATION.test(reply)) return "integration";
  return undefined;
}
