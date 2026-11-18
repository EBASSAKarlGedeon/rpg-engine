// def-presets.js — one-click starter packs for the world editor's Stats / Trackers /
// NPC Trackers tabs (the 📋 Presets buttons in world-editor.js). Edit freely: each entry is a
// plain def object with the same fields the editor rows use. Tracker entries carry `effects`
// (WHAT the value means + HOW high/low values affect play — GM-facing) and `rules`
// (WHEN the value changes — tracker-update-call-only).
// Packs are deliberately cross-genre — fantasy, sci-fi, modern, horror, mystery, survival.

export const STAT_PRESETS = [
  { key: "str", label: "Strength", start: 10, max: 50, hint: "Raw physical power.", rules: "Used for melee attacks, grappling, breaking things, and carrying. High strength hits harder and lifts more." },
  { key: "agi", label: "Agility", start: 10, max: 50, hint: "Speed and coordination.", rules: "Used for dodging, stealth, initiative, and fine movement. High agility acts first and evades often." },
  { key: "end", label: "Endurance", start: 10, max: 50, hint: "Stamina and toughness.", rules: "Used to resist poison, exhaustion, and pain, and to keep going on long marches." },
  { key: "int", label: "Intellect", start: 10, max: 50, hint: "Reasoning and knowledge.", rules: "Used for lore, puzzles, crafting, and understanding strange magic or devices." },
  { key: "wit", label: "Wit", start: 10, max: 50, hint: "Perception and quick thinking.", rules: "Used to notice hidden things, read people, and react to surprises." },
  { key: "cha", label: "Charm", start: 10, max: 50, hint: "Social influence.", rules: "Used to persuade, deceive, haggle, and lead. High charm opens doors that words alone can open." },
  { key: "luck", label: "Luck", start: 10, max: 50, hint: "Fortune and fate.", rules: "Used when outcomes are pure chance. High luck turns near-misses into miracles." },
  { key: "stealth", label: "Stealth", start: 10, max: 50, hint: "Moving unseen.", rules: "Used to sneak, hide, tail targets, and steal. High stealth goes unnoticed even under watch." },
  { key: "magic", label: "Magic", start: 10, max: 50, hint: "Spell power and control.", rules: "Used to cast, shape, and resist spells. High magic hits harder, lasts longer, and bends stranger forces." },
  { key: "perception", label: "Perception", start: 10, max: 50, hint: "Noticing the world.", rules: "Used to spot hidden things, hear distant sounds, and sense danger. High perception misses nothing." },
  { key: "wisdom", label: "Wisdom", start: 10, max: 50, hint: "Judgment and insight.", rules: "Used to read people, weigh choices, and see through deception. High wisdom chooses well under pressure." },
  { key: "nature", label: "Nature", start: 10, max: 50, hint: "Lore of living things.", rules: "Used to know beasts, plants, and wild places, and to calm or handle animals. High nature thrives outdoors." },
  { key: "history", label: "History", start: 10, max: 50, hint: "Knowledge of the past.", rules: "Used to recall wars, lineages, ruins, and old laws. High history turns the past into leverage." },
  { key: "tech", label: "Tech", start: 10, max: 50, hint: "Operating and repairing technology.", rules: "Used to hack, repair, pilot by wire, and understand machines. High tech keeps gear alive and doors open." },
  { key: "med", label: "Medicine", start: 10, max: 50, hint: "Healing and first aid.", rules: "Used to treat wounds, diagnose illness, and perform surgery. High medicine saves lives that would otherwise be lost." },
  { key: "surv", label: "Survival", start: 10, max: 50, hint: "Wilderness living.", rules: "Used to track, forage, hunt, navigate wilds, and endure the elements." },
  { key: "scav", label: "Scavenging", start: 10, max: 50, hint: "Finding useful scrap.", rules: "Used to search ruins, trash, and battlefields for usable loot. High scavenging finds valuables where others see junk." },
];

export const TRK_PRESETS = [
  { key: "level", label: "Level", icon: "🏅", type: "number", show: "hero", start: 1, max: "", hint: "Power tier.", effects: "The hero\u2019s level; higher levels gate tougher challenges and greater rewards.", rules: "Increase when exp is full." },
  { key: "exp", label: "Experience", icon: "✨", type: "number", show: "hero", start: 0, max: 100, hint: "Progress to next level.", effects: "Progress toward the next level; at max it resets and level rises.", rules: "Award it for victories, quests, and breakthroughs." },
  { key: "quest", label: "Objective", icon: "📜", type: "text", show: "header", start: "", max: "", hint: "Current goal.", effects: "The hero\u2019s single current goal, one short phrase; only one at a time.", rules: "Replace it when completed or abandoned." },
  { key: "location", label: "Location", icon: "📍", type: "text", show: "header", start: "", max: "", hint: "Where the hero is.", effects: "Where the hero currently is.", rules: "Update whenever the scene moves." },
  { key: "hp", label: "HP", icon: "❤️", type: "number", show: "hero", start: 100, max: 100, hint: "Health.", effects: "The hero\u2019s health; at 0 they are downed.", rules: "Lose it to enemy hits and hazards; restore it by healing, rest, or potions." },
  { key: "mana", label: "Mana", icon: "🔮", type: "number", show: "hero", start: 100, max: 100, hint: "Magical fuel.", effects: "Magical fuel; at 0 no spells can be cast.", rules: "Spend it on magic; recover it by rest, crystals, or ley lines." },
  { key: "stamina", label: "Stamina", icon: "⚡", type: "number", show: "hero", start: 100, max: 100, hint: "Short-term exertion.", effects: "Short-term energy for sprinting, fighting, and hard labor; at 0 the hero is exhausted and must rest.", rules: "Burns fast, recovers with breaks." },
  { key: "rep", label: "Reputation", icon: "⭐", type: "number", show: "hero", start: 0, max: "", hint: "Standing in the world.", effects: "How the world regards the hero; high standing opens alliances and discounts, low standing brings suspicion and closed doors.", rules: "Moves with public deeds." },
  { key: "gold", label: "Gold", icon: "🪙", type: "number", show: "hero", start: 0, max: "", hint: "Coin on hand.", effects: "The hero\u2019s coin; wealth gates bribes, gear, and services.", rules: "Gain it from loot, quests, and trade; spend it on supplies and favors." },
  { key: "money", label: "Money", icon: "💵", type: "number", show: "hero", start: 0, max: "", hint: "Modern cash.", effects: "Modern cash on hand; wealth gates bribes, gear, and services.", rules: "Earn it from jobs, quests, and sales; spend it on supplies and favors." },
  { key: "supplies", label: "Supplies", icon: "🎒", type: "number", show: "hero", start: 5, max: "", hint: "Food and consumables.", effects: "Food, ammo, and consumables; at 0 the party goes hungry.", rules: "Consume them on the road; restock in towns." },
  { key: "day", label: "Day", icon: "📅", type: "number", show: "header", start: 1, max: "", hint: "Day count.", effects: "How many days have passed since the story began.", rules: "Advance it as each day passes in the story." },
  { key: "dayname", label: "Day Name", icon: "🗓️", type: "text", show: "header", start: "", max: "", hint: "Weekday name.", effects: "The current weekday name (Monday, Tuesday, ...). Can\u2019t be empty.", rules: "Advance it whenever the day changes." },
  { key: "date", label: "Date", icon: "📆", type: "text", show: "header", start: "", max: "", hint: "Calendar date.", effects: "The full calendar date; festivals, paydays, and deadlines key off it.", rules: "Update when day changes." },
  { key: "time", label: "Time", icon: "🕐", type: "text", show: "header", start: "09:00 AM", max: "", hint: "Time of day.", effects: "The current time of day in this format: 09:00 AM.", rules: "Advances naturally with the narrative, always move forward." },
];

export const NTRK_PRESETS = [
  { key: "hp", label: "HP", icon: "❤️", type: "number", start: 100, max: 100, hint: "Health.", effects: "The character\u2019s health.", rules: "Lose it to enemy hits and hazards; restore it by healing, rest, or potions." },
  { key: "relationship", label: "Relationship", icon: "👥", type: "text", start: "", max: "", hint: "Bond with the hero.", effects: "How this character is bonded to the hero (stranger, friend, rival, lover...); the bond gates what they will do for each other.", rules: "Deepens or breaks with shared trials." },
  { key: "trust", label: "Trust", icon: "🤝", type: "number", start: 50, max: 100, hint: "Faith in the hero.", effects: "How much this character trusts the hero; high trust unlocks secrets and aid, low trust risks betrayal.", rules: "Moves when the hero keeps or breaks promises." },
  { key: "mood", label: "Mood", icon: "🎭", type: "text", start: "", max: "", hint: "Emotional state.", effects: "Current emotional state; a hostile mood closes dialogue options while a warm one opens them.", rules: "Shifts with how the hero treats them." },
  { key: "condition", label: "Condition", icon: "🩹", type: "text", start: "healthy", max: "", hint: "Physical state.", effects: "Physical state; while wounded the character fights poorly and needs protection.", rules: "Worsens on injury, improves with rest and healing." },
  { key: "favor", label: "Favor", icon: "🙏", type: "number", start: 0, max: "", hint: "Debts owed.", effects: "Debts between this character and the hero; positive means they owe the hero.", rules: "Earn it with aid, spend it to ask hard things." },
  { key: "fear", label: "Fear", icon: "😨", type: "number", start: 0, max: 100, hint: "Fear of the hero.", effects: "How afraid this character is of the hero; high fear forces obedience but kills honesty.", rules: "Rises with threats and displays of power, fades with kindness." },
  { key: "loyalty", label: "Loyalty", icon: "🛡️", type: "number", start: 50, max: 100, hint: "Devotion to the cause.", effects: "Devotion to the hero\u2019s cause rather than the person; high loyalty holds the line in defeat, low loyalty defects for better offers.", rules: "Moves with victories, ideals, and pay." },
  { key: "romance", label: "Romance", icon: "💘", type: "number", start: 0, max: 100, hint: "Romantic interest.", effects: "Romantic interest in the hero; high romance opens devotion and jealousy arcs, low closes them.", rules: "Grows with intimacy and gestures, dies with neglect or cruelty." },
];
