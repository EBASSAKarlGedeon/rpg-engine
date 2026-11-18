// Tiny OpenAI-compatible mock server for tests. Streams a canned GM reply and records every request.
// Usage: node tools/mock-llm.js <log-file> [port]
const http = require("http");
const fs = require("fs");
const LOG = process.argv[2] || "mock.log";
const PORT = Number(process.argv[3] || 8766);

http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let j = {};
    try { j = JSON.parse(body); } catch (e) {}
    const msgs = j.messages || [];
    const all = msgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    fs.appendFileSync(LOG, JSON.stringify({
      model: j.model, stream: !!j.stream, max_tokens: j.max_tokens, chars: all.length,
      kind: /GM INSTRUCTIONS/.test(all) ? "gm"
        : /scene tracker/i.test(all) ? "staging"
        : /game-state tracker/i.test(all) ? "hero-tracker"
        : /character-state tracker/i.test(all) ? "npc-tracker"
        : /skill-check referee/i.test(all) ? "check"
        : /mapmaker/i.test(all) ? "map"
        : /paint character portraits/i.test(all) ? "location-phrase" : "other",
    }) + "\n");
    const text = /GM INSTRUCTIONS/.test(all)
      ? 'Dust drifts through a slanted shaft of light as you look around the hall.\n\n[Dharra] "You came. Good. Sit."\n[Dharra inner] He looks nothing like the others.\n\n[[NPC: Dharra | Goddess of the in-between, patient and dry-witted.]]'
      : "OK";
    if (j.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const p of text.match(/[\s\S]{1,24}/g) || [text]) {
        res.write("data: " + JSON.stringify({ choices: [{ delta: { content: p } }] }) + "\n\n");
      }
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
  });
}).listen(PORT, "127.0.0.1", () => console.log("mock LLM listening on " + PORT));
