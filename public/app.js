// Every piece of text is inserted with textContent, never innerHTML,
// so nothing in a reply can ever run as markup or script.
const log = document.getElementById("log");
const form = document.getElementById("form");
const input = document.getElementById("input");
const send = document.getElementById("send");
input.dir = "auto";
let sessionId = null;

function add(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.dir = "auto"; // right-to-left text (Arabic, Urdu...) lays out correctly
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  add("user", text);
  input.value = "";
  send.disabled = true;
  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const data = await res.json();
    if (data.sessionId) sessionId = data.sessionId;
    add("bot", typeof data.reply === "string" ? data.reply : "Error");
  } catch {
    add("bot", "Network error. Please try again.");
  } finally {
    send.disabled = false;
    input.focus();
  }
});
