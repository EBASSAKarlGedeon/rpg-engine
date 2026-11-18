// Import from SillyTavern core
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// Extension name MUST match folder name
const extensionName = "rpg-engine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Same-window overlay state for the Loreweaver bridge page (see onBridgeClick).
const bridgeUi = { root: null, frame: null };

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
    const app = window.rpgEngine;
    if (app && typeof app.open === "function") {
        toastr.info("Opening the RPG Engine…", "RPG Engine");
        app.open();
    } else {
        toastr.error("The game app did not load — see the browser console.", "RPG Engine");
        console.error(`[${extensionName}] window.rpgEngine is missing; the port wrapper failed to load.`);
    }
}

function onBridgeClick() {
    // Open the bridge page in a same-window overlay (iframe), like the game — no
    // new Electron BrowserWindow / renderer spawn, so there is no window-creation
    // delay. Same origin, so the bridge page still sees the session + localStorage.
    const base = new URL("./rpg-engine-port/rpg-engine/", import.meta.url).href;
    const url = base + "app/loreweaver-bridge.html";
    if (!bridgeUi.root) {
        const root = document.createElement("div");
        root.id = "rpge-bridge-root";
        root.hidden = true;
        const bar = document.createElement("div");
        bar.className = "rpge-bridge-bar";
        const title = document.createElement("span");
        title.className = "rpge-bridge-title";
        title.textContent = "LOREWEAVER BRIDGE";
        const close = document.createElement("button");
        close.type = "button";
        close.className = "rpge-bridge-close";
        close.textContent = "Close ✕";
        close.setAttribute("aria-label", "Close Loreweaver bridge");
        close.addEventListener("click", closeBridgeOverlay);
        bar.append(title, close);
        const frame = document.createElement("iframe");
        frame.id = "rpge-bridge-frame";
        frame.title = "Loreweaver bridge";
        root.append(bar, frame);
        document.body.appendChild(root);
        bridgeUi.root = root;
        bridgeUi.frame = frame;
    }
    if (!bridgeUi.frame.getAttribute("src")) bridgeUi.frame.setAttribute("src", url); // lazy load
    bridgeUi.root.hidden = false;
    document.documentElement.classList.add("rpge-bridge-open");
}

function closeBridgeOverlay() {
    if (!bridgeUi.root) return;
    bridgeUi.root.hidden = true; // keep the iframe alive
    document.documentElement.classList.remove("rpge-bridge-open");
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
        // Escape closes the bridge overlay (the game overlay has its own Close button).
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && bridgeUi.root && !bridgeUi.root.hidden) closeBridgeOverlay();
        });
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
