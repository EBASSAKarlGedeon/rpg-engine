// Build a minimal v2 character card PNG (1x1 pixel + tEXt chara chunk).
const zlib = require("zlib");
const fs = require("fs");

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
const raw = Buffer.from([0, 255, 0, 0]); // filter 0 + RGB
const idat = zlib.deflateSync(raw);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", idat)
]);
const card = {
  spec: "chara_card_v2", spec_version: "2.0",
  data: {
    name: "Bram Testwell",
    description: "A gruff ferryman who knows every sandbar of the Vess. Keeps one oar for luck and one for fighting.",
    personality: "Terse, superstitious, secretly generous.",
    scenario: "The river crossing at dawn.",
    first_mes: "You again? The current's high. Get in or get gone.",
    mes_example: "",
    creator_notes: "Heavy-test NPC",
    system_prompt: "",
    post_history_instructions: "",
    tags: ["test"],
    creator: "tester",
    character_version: "1.0",
    alternate_greetings: [],
    extensions: {},
    character_book: {
      name: "Bram's book",
      entries: [
        { keys: ["ferry", "crossing"], content: "The ferry crosses at dawn and dusk only — never at night, never for free.", enabled: true, insertion_order: 1, case_sensitive: false },
        { keys: ["oar"], content: "The second oar has notches. Bram counts them when he thinks no one watches.", enabled: true, insertion_order: 2, case_sensitive: false }
      ]
    }
  }
};
const text = Buffer.from("chara\0" + Buffer.from(JSON.stringify(card), "utf8").toString("base64"), "ascii");
fs.writeFileSync(__dirname + "/../fixtures/bram-testwell.png", Buffer.concat([png, chunk("tEXt", text), chunk("IEND", Buffer.alloc(0))]));
console.log("card png written:", fs.statSync(__dirname + "/../fixtures/bram-testwell.png").size, "bytes");
