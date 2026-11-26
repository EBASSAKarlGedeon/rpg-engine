import test from "node:test";
import assert from "node:assert/strict";
import { contentHash, entriesToLore, replaceInWorld, restoreInWorld, removeFromWorld } from "../rpg-engine-port/rpg-engine/app/src/scripts/lorebook-link.js";

function book() {
  return {
    "1": { comment: "Rin", key: ["Rin", "Tohsaka"], content: "Rin is a mage.", constant: false },
    "2": { comment: "Rules", key: [], content: "Servants are spirits.", constant: true },
    "3": { comment: "Off", key: ["x"], content: "disabled", disable: true },
    "4": { comment: "Empty", key: ["e"], content: "   " }
  };
}

test("entriesToLore skips disabled and empty entries and tags provenance", () => {
  const lore = entriesToLore(book(), "book-a");
  assert.equal(lore.length, 2);
  assert.deepEqual(lore[0].src, { book: "book-a", uid: "1" });
  assert.equal(lore[0].activation, "keywords");
  assert.deepEqual(lore[0].keywords, ["Rin", "Tohsaka"]);
  assert.equal(lore[1].activation, "always");
});

test("contentHash changes when an entry body changes, not when order does", () => {
  const a = book();
  const h1 = contentHash(a);
  const b = { "1": Object.assign({}, a["1"], { content: "Rin is a magus." }), "2": a["2"], "3": a["3"], "4": a["4"] };
  assert.notEqual(contentHash(b), h1);
  const reordered = { "2": a["2"], "4": a["4"], "1": a["1"], "3": a["3"] };
  assert.equal(contentHash(reordered), h1);
});

test("replaceInWorld replaces only this book's entries and keeps a backup", () => {
  const world = { lorebook: [{ title: "hand written", content: "mine" }, { title: "Rin", content: "old", src: { book: "book-a", uid: "1" } }] };
  const lore = entriesToLore(book(), "book-a");
  const r = replaceInWorld(world, "book-a", lore, [], 111);
  assert.equal(r.replaced, 1);
  assert.equal(r.world.lorebook.length, 3);
  assert.equal(r.world.lorebook[0].content, "mine");
  assert.equal(r.world.lorebookBackup["book-a"].entries.length, 1);
  assert.equal(r.world.lorebookBackup["book-a"].at, 111);
  // input world untouched
  assert.equal(world.lorebook.length, 2);
});

test("legacy links (no src tag) are matched by recorded titles", () => {
  const world = { lorebook: [{ title: "Rules", content: "old rules" }, { title: "mine", content: "keep" }] };
  const r = replaceInWorld(world, "book-b", entriesToLore(book(), "book-b"), ["rules"]);
  assert.equal(r.replaced, 1);
  assert.equal(r.world.lorebook.filter(function (e) { return e.content === "keep"; }).length, 1);
});

test("restore puts the backup back and drops it", () => {
  const lore = entriesToLore(book(), "book-a");
  const first = replaceInWorld({ lorebook: [] }, "book-a", lore, [], 1).world;
  const pulled = replaceInWorld(first, "book-a", lore.slice(0, 1), [], 2).world;
  assert.equal(pulled.lorebook.length, 1);
  const back = restoreInWorld(pulled, "book-a", []);
  assert.equal(back.empty, false);
  assert.equal(back.world.lorebook.length, 2);
  assert.equal(back.world.lorebookBackup["book-a"], undefined);
  assert.equal(restoreInWorld(back.world, "book-a", []).empty, true);
});

test("remove deletes only this book's entries and its backup", () => {
  const lore = entriesToLore(book(), "book-a");
  const world = replaceInWorld({ lorebook: [{ title: "mine", content: "keep" }] }, "book-a", lore, [], 1).world;
  const out = removeFromWorld(world, "book-a", []);
  assert.equal(out.removed, 2);
  assert.deepEqual(out.world.lorebook.map(function (e) { return e.content; }), ["keep"]);
  assert.equal((out.world.lorebookBackup || {})["book-a"], undefined);
});
