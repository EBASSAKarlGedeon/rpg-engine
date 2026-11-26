// Import from SillyTavern core
// Absolute paths on purpose: this folder used to live one level deeper (extensions/third-party/),
// so a relative ../../.. silently 404s after the move and the whole extension never registers.
import { extension_settings, getContext, loadExtensionSettings } from "/scripts/extensions.js";
import { saveSettingsDebounced } from "/script.js";

// Extension name MUST match folder name
const extensionName = "rpg-engine";
// Derived from this module's own URL, so the settings HTML resolves wherever the folder sits.
const extensionFolderPath = new URL(".", import.meta.url).pathname.replace(/^\//, "").replace(/\/$/, "");

// Same-window overlay page: the full game. The old bridge/imports overlay pages are gone
// since [rpge-patch 018] — their logic lives INSIDE the game app now (Settings → AI Model
// section, and the "Import from Loreweaver" landing page), and these buttons deep-link there.
// The full game app lives inside the port folder. Its own wrapper (rpg-engine-port/rpg-engine/index.js)
// adds the floating ⚔ launcher + wand-menu entry + full-screen overlay, and exposes window.rpgEngine.

const defaultSettings = {
    enabled: false
};

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    $("#rpg_engine_checkbox").prop("checked", extension_settings[extensionName].enabled);
}

function onCheckboxChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].enabled = value;
    saveSettingsDebounced();
    console.log(`[${extensionName}] Setting saved:`, value);
}

function onButtonClick() {
    // Launch the game instead of just reporting status.
    openGame();
}

// Deep-link into the game app (postMessage; the app handles landing-vs-chat re-entry):
//   "imports"          → the "Import from Loreweaver" landing page
//   "settings/aimodel" → Settings popup on the AI Model section (the old bridge page)
function openGame(target) {
    const app = window.rpgEngine;
    if (!app || typeof app.open !== "function") {
        toastr.error("The game app did not load — see the browser console.", "RPG Engine");
        console.error(`[${extensionName}] window.rpgEngine is missing; the port wrapper failed to load.`);
        return;
    }
    if (!target) { app.open(); return; }
    app.open(target);
}

function onBridgeClick() {
    toastr.info("Opening the RPG Engine — AI Model settings…", "RPG Engine");
    openGame("settings/aimodel");
}

function onImportClick() {
    toastr.info("Opening the RPG Engine — Import page…", "RPG Engine");
    openGame("imports");
}

// Extension initialization
jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);

    try {
        // Load HTML from file
        const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);

        // Append to settings panel (right column for UI extensions)
        $("#extensions_settings2").append(settingsHtml);

        // Bind events and load saved settings
        $("#rpg_engine_checkbox").on("input", onCheckboxChange);
        $("#rpg_engine_button").on("click", onButtonClick);
        $("#rpg_engine_bridge").on("click", onBridgeClick);
        $("#rpg_engine_import").on("click", onImportClick);
        loadSettings();

        // Load the game wrapper (overlay + ⚔ launcher + wand-menu entry).
        import(new URL("./rpg-engine-port/rpg-engine/index.js", import.meta.url).href)
            .then(() => console.log(`[${extensionName}] 🎮 game wrapper loaded`))
            .catch((error) => console.error(`[${extensionName}] ❌ game wrapper failed:`, error));

        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});
