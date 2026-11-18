// Stand-ins for the Perchance platform plugins that the generator expects as globals on `root`.
// Classic script. It MUST load before src/scripts/boot.js (which copies root.* onto window.*).
//
// What this file provides:
//   kv                IndexedDB-backed key/value "folders" (rpg, worlds, community, embvec, ...)
//   generateText      the app's "Perchance AI" slot. Here it is an OPTIONAL cheap secondary model
//                     (configure it on cheap-model.html). Any route you switch OFF in
//                     Settings > AI Model > routes runs on this model instead of the main one.
//   generateImage     not available (use Settings > Image Gen with your own provider)
//   uploadPlugin, createServerSocket, commentsPlugin, copyTextPlugin  offline stubs
(function () {
  "use strict";

  /* ------------------------------------------------------------------ kv */
  const DB_NAME = "rpge-kv", STORE = "kv", SEP = "\u0000";
  let dbPromise = null;
  const openDb = () => dbPromise || (dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function tx(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      let out;
      Promise.resolve(fn(t.objectStore(STORE))).then((v) => { out = v; }, reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  function makeFolder(name) {
    const k = (key) => name + SEP + String(key);
    const range = () => IDBKeyRange.bound(name + SEP, name + SEP + "￿");
    const strip = (full) => full.slice(name.length + 1);
    return {
      get: (key) => tx("readonly", (s) => wrap(s.get(k(key)))),
      getMany: (keys) => tx("readonly", (s) => Promise.all(keys.map((x) => wrap(s.get(k(x)))))),
      has: (key) => tx("readonly", async (s) => (await wrap(s.count(k(key)))) > 0),
      set: async (key, value) => { await tx("readwrite", (s) => wrap(s.put(plain(value), k(key)))); return value; },
      setMany: (obj) => tx("readwrite", async (s) => { for (const [key, v] of Object.entries(obj || {})) await wrap(s.put(plain(v), k(key))); }),
      delete: (key) => tx("readwrite", (s) => wrap(s.delete(k(key)))),
      deleteMany: (keys) => tx("readwrite", async (s) => { for (const x of keys) await wrap(s.delete(k(x))); }),
      keys: async () => (await tx("readonly", (s) => wrap(s.getAllKeys(range())))).map(strip),
      values: () => tx("readonly", (s) => wrap(s.getAll(range()))),
      entries: () => tx("readonly", async (s) => {
        const keys = await wrap(s.getAllKeys(range()));
        const vals = await wrap(s.getAll(range()));
        return keys.map((x, i) => [strip(x), vals[i]]);
      }),
      clear: () => tx("readwrite", (s) => wrap(s.delete(range()))),
      // read-modify-write inside ONE transaction; fn may mutate and return the value (or return a new one)
      update: (key, fn) => tx("readwrite", async (s) => {
        const cur = await wrap(s.get(k(key)));
        const next = await fn(cur);
        await wrap(s.put(plain(next === undefined ? cur : next), k(key)));
        return next;
      }),
    };
  }
  const folders = {};
  const kv = new Proxy({}, {
    get(_, name) {
      if (typeof name !== "string") return undefined;
      return folders[name] || (folders[name] = makeFolder(name));
    },
  });

  /* ------------------------------------------------- generateText (cheap model slot) */
  const CHEAP_KEY = "rpge.cheapModel"; // {baseUrl, apiKey, model, temperature?, extraBody?}
  const readCheap = () => {
    try {
      const c = JSON.parse(localStorage.getItem(CHEAP_KEY) || "null");
      return c && c.baseUrl && c.model ? c : null;
    } catch (e) { return null; }
  };
  const asText = (instruction) => (Array.isArray(instruction)
    ? instruction.filter((p) => typeof p === "string" || p instanceof String).join("")
    : String(instruction == null ? "" : instruction));

  function generateText(input, extra) {
    // The engine asks for a token counter this way; a rough estimate is fine.
    if (input && typeof input === "object" && input.getMetaObject === true) {
      return { countTokens: (t) => Math.ceil(String(t).length / 4) };
    }
    const opts = typeof input === "string" || input instanceof String
      ? Object.assign({ instruction: String(input) }, extra || {})
      : Object.assign({}, input || {});
    const cfg = readCheap();
    const ctrl = new AbortController();
    let reader = null;
    const p = (async () => {
      if (!cfg) {
        throw new Error("No secondary model is set up. Either keep every route on your main provider (Settings > AI Model), or configure the cheap model on cheap-model.html.");
      }
      const startWith = typeof opts.startWith === "string" ? opts.startWith : "";
      const shownPrefix = startWith && !opts.hideStartWith ? startWith : "";
      let acc = shownPrefix, generated = "";
      const fire = (chunk) => {
        if (typeof opts.onChunk === "function") {
          try { opts.onChunk({ fullTextSoFar: acc, textChunk: chunk }); } catch (e) { console.error("onChunk:", e); }
        }
      };
      if (typeof opts.onStart === "function") { try { opts.onStart(p); } catch (e) {} }
      if (shownPrefix) fire(shownPrefix);

      const messages = [{ role: "user", content: asText(opts.instruction) }];
      if (startWith) messages.push({ role: "assistant", content: startWith });
      const body = Object.assign({ model: cfg.model, messages, stream: true }, cfg.extraBody || {});
      const cap = parseInt(opts.maxTokens, 10);
      if (Number.isFinite(cap) && cap > 0) body.max_tokens = cap;
      const stops = Array.isArray(opts.stopSequences) ? opts.stopSequences : opts.stopSequences ? [opts.stopSequences] : [];
      if (stops.length) body.stop = stops.slice(0, 4);
      const temp = opts.temperature != null ? opts.temperature : cfg.temperature;
      if (typeof temp === "number") body.temperature = temp;

      const headers = { "Content-Type": "application/json" };
      if (cfg.apiKey) headers.Authorization = "Bearer " + cfg.apiKey;
      let res;
      try {
        res = await fetch(String(cfg.baseUrl).replace(/\/+$/, "") + "/chat/completions", {
          method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal,
        });
      } catch (e) {
        if (e && e.name === "AbortError") return finish();
        throw new Error("Could not reach the secondary model endpoint: " + (e.message || e));
      }
      if (!res.ok) {
        let detail = res.status + " " + res.statusText;
        try { const j = await res.json(); if (j && j.error && j.error.message) detail = j.error.message; } catch (e) {}
        throw new Error("Secondary model API error: " + detail);
      }
      if ((res.headers.get("content-type") || "").includes("application/json")) {
        const j = await res.json();
        const txt = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "") : "";
        if (txt) { generated += txt; acc += txt; fire(txt); }
      } else {
        reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "", done = false;
        while (!done) {
          let r;
          try { r = await reader.read(); } catch (e) { if (e && e.name === "AbortError") break; throw e; }
          if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          const events = buf.split("\n\n");
          buf = events.pop();
          for (const ev of events) {
            for (const line of ev.split("\n")) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const payload = t.slice(5).trim();
              if (payload === "[DONE]") { done = true; break; }
              let j = null;
              try { j = JSON.parse(payload); } catch (e) { continue; }
              const piece = j && j.choices && j.choices[0] && j.choices[0].delta ? j.choices[0].delta.content : "";
              if (piece) { generated += piece; acc += piece; fire(piece); }
            }
            if (done) break;
          }
        }
      }
      return finish();

      function finish() {
        const out = new String(acc);
        out.text = acc;
        out.generatedText = generated;
        if (typeof opts.onFinish === "function") { try { opts.onFinish(out); } catch (e) {} }
        return out;
      }
    })();
    p.stop = () => {
      try { ctrl.abort(); } catch (e) {}
      try { if (reader) Promise.resolve(reader.cancel()).catch(() => {}); } catch (e) {}
      return p;
    };
    return p;
  }

  const generateImage = () => Promise.reject(new Error(
    "The built-in image generator is not available here. Open Settings > Image Gen and choose an external provider."));

  /* ------------------------------------------- community / hosting plugins: offline stubs */
  const offline = () => Promise.reject(new Error("offline"));
  const noop = () => {};
  // Calls reject quietly so the community features simply fail "offline".
  const uploadPlugin = Object.assign((..._a) => { const p = offline(); p.catch(noop); return p; }, { upload: offline });
  const createServerSocket = () => new Proxy(function () {}, {
    get: () => (..._a) => { const p = offline(); p.catch(noop); return p; },
    apply: () => { const p = offline(); p.catch(noop); return p; },
  });
  const commentsPlugin = () => ({});

  window.root = {
    generateText, generateImage, kv, uploadPlugin, createServerSocket, commentsPlugin,
    copyTextPlugin: (t) => { try { return navigator.clipboard.writeText(String(t)); } catch (e) { return Promise.resolve(); } },
    communityResLib: null,
    $meta: { title: { evaluateItem: "RPG ENGINE" } },
  };
})();
