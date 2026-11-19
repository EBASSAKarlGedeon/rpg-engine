function makeWorld() {
  const npcs = [
    { name: "Mira", age: "27", gender: "female", race: "human", appearance: "Short dark hair, ink-stained fingers, a leather satchel of maps.", job: "Cartographer", persona: "Sharp-tongued, restless, always halfway out the door. Talks fast when nervous.", secrets: "She is being followed by a debt collector.", extra: "", avatar: "", trackers: {} },
    { name: "Olek", age: "52", gender: "male", race: "human", appearance: "Grey beard, burn scars on one forearm, smells of pine resin.", job: "Bridge keeper", persona: "Slow to speak, quick to act. Hums old marching songs.", secrets: "He buried something under the east pillar.", extra: "", avatar: "", trackers: {} }
  ];
  return {
    format: "mno-world", version: 1,
    meta: { id: "wstress", name: "Stress Test Valley", description: "A test world.", author: "tester", authorId: "", tags: [], nsfw: false },
    narrativeVibe: "Grounded fantasy, tense but hopeful.",
    worldDescription: "A rain-slick valley with one stone bridge, a flooded mill, and a crossroads inn. The river has been rising for days.",
    proseRules: true, threadFires: true, sceneDice: true,
    lorebook: [
      { id: "l1", keys: ["river", "flood"], name: "The Rising", text: "The river Vess has flooded three times in living memory. Each flood took a barn and gave back a boat.", always: false },
      { id: "l2", keys: ["inn"], name: "The Split Cask", text: "The crossroads inn, run by a retired smuggler who charges double for questions.", always: false }
    ],
    scenario: "The hero arrives at the valley as the river begins to rise.",
    start: "Rain hammers the crossroads sign. The bridge keeper waves you toward the inn.",
    startMode: "verbatim",
    starts: [{ id: "start", title: "Arrival", description: "", text: "Rain hammers the crossroads sign. The bridge keeper waves you toward the inn.", mode: "verbatim" }],
    imageStyleTags: "", imageNegativeTags: "",
    imageIncludeTrackers: false, imageIncludeNpcTrackers: false,
    imageTrackerKeys: [], imageNpcTrackerKeys: [],
    stats: {
      cfg: { pointsPerLevel: 2, ccBudget: 12, ccFloor: 5, averageThreshold: 10, exceptionalThreshold: 15, modStep: 5, dieSides: 20 },
      defs: [
        { key: "grit", label: "Grit", type: "number", start: 8, min: 1, max: 20, icon: "🪨", color: "#b0713a", show: "hero", effects: "", rules: "" },
        { key: "wit", label: "Wit", type: "number", start: 9, min: 1, max: 20, icon: "💡", color: "#7a6fc4", show: "hero", effects: "", rules: "" }
      ]
    },
    trackers: [
      { key: "supplies", label: "Supplies", type: "number", start: 3, max: 10, icon: "🎒", color: "#5a8f5a", show: "both", effects: "", rules: "Falls on travel, buys at the inn." },
      { key: "suspicion", label: "Suspicion", type: "number", start: 1, max: 10, icon: "👁", color: "#a33", show: "both", effects: "", rules: "Rises when the hero is caught prying." }
    ],
    npcTrackers: [
      { key: "patience", label: "Patience", type: "number", start: 5, max: 10, icon: "⏳", color: "#888", show: "profile" }
    ],
    npcs
  };
}

function makeSession() {
  const msgs = [];
  for (let i = 1; i <= 11; i++) {
    msgs.push({ role: "action", text: i === 1 ? "I shrug off my soaked cloak and step inside." : `I ask about the rising river (visit ${i}).` });
    msgs.push({ role: "narrator", text: `Turn ${i}: The inn's fire crackles. Mira sketches river levels on a napkin; Olek hums by the door. The rain keeps coming.` });
    if (i % 2 === 0) msgs.push({ role: "npc", name: "Mira", text: `Turn ${i}: You again? Fine — one question, then I work.` });
  }
  return {
    id: "s_stress_1",
    name: "Heavy Test Run",
    worldId: "wstress", worldName: "Stress Test Valley",
    turn: msgs.filter(m => m.role === "action").length, // 11 — recomputed from messages anyway
    character: { name: "Wren", portrait: "", age: "30", gender: "female", race: "human", appearance: "", job: "Courier", persona: "", extra: "", background: "", stats: {}, statPoints: 0, statFloors: {}, trackerModes: {} },
    messages: msgs,
    npcs: {
      "Mira": { name: "Mira", portrait: "", description: "", details: null, importance: "medium", appearanceCount: 5, firstSeenTurn: 1, lastSeenTurn: 10, everSpoke: true, pinned: false, trackers: null },
      "Olek": { name: "Olek", portrait: "", description: "", details: null, importance: "medium", appearanceCount: 3, firstSeenTurn: 1, lastSeenTurn: 8, everSpoke: true, pinned: false, trackers: null }
    },
    settings: { showInnerThoughts: false, rollChecks: true, simNpcLife: true, showTrackerChanges: true },
    openThreads: [
      { text: "The debt collector following Mira closes in.", from: 3, lastFired: null },
      { text: "Something Olek buried under the east pillar.", from: 5, lastFired: null }
    ],
    memories: { notes: [], history: [] },
    latestSituation: "", latestSituationTurn: 0,
    lastAutoMemoryTurn: 0, lastNpcLifeTurn: 0, lastSceneDiceTurn: 0
  };
}

module.exports = { makeWorld, makeSession };
