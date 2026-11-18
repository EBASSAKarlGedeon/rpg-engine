// Import from SillyTavern core
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// Extension name MUST match folder name
const extensionName = "rpg-engine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Same-window overlay pages (bridge / imports), like the game — no new Electron BrowserWindow
// renderer spawn, so no window-creation delay. Same origin, so they see the session.
// The full game app lives inside the port folder. Its own wrapper (rpg-engine-port/rpg-engine/index.js)
// adds the floating ⚔ launcher + wand-menu entry + full-screen overlay, and exposes window.rpgEngine.

const PAGE_URLS = {
    bridge: new URL("./rpg-engine-port/rpg-engine/app/loreweaver-bridge.html", import.meta.url).href,
    imports: new URL("./rpg-engine-port/rpg-engine/app/loreweaver-import.html", import.meta.url).href,
};
const PAGE_TITLES = { bridge: "LOREWEAVER BRIDGE", imports: "LOREWEAVER IMPORTS" };
const overlayPages = {};

// One overlay per page id: {root, frame}. Reuses the game-overlay pattern (iframe in a bar'd
// root, hidden not removed, so state survives close/open).
function makeOverlayPage(id) {
    const root = document.createElement("div");
    root.id = "rpge-page-" + id;
    root.className = "rpge-page-root"; // styled by style.css (class-scoped, any overlay page)
    root.hidden = true;
    const bar = document.createElement("div");
    bar.className = "rpge-bridge-bar";
    const t = document.createElement("span");
    t.className = "rpge-bridge-title";
    t.textContent = PAGE_TITLES[id];
    const close = document.createElement("button");
    close.type = "button";
    close.className = "rpge-bridge-close";
    close.textContent = "Close ✕";
    close.setAttribute("aria-label", "Close " + PAGE_TITLES[id]);
    close.addEventListener("click", () => closeOverlayPage(id));
    bar.append(t, close);
    const frame = document.createElement("iframe");
    frame.id = "rpge-page-frame-" + id;
    frame.className = "rpge-page-frame";
    frame.title = PAGE_TITLES[id];
    root.append(bar, frame);
    document.body.appendChild(root);
    return { root, frame, url: PAGE_URLS[id] };
}

function openOverlayPage(id) {
    const page = overlayPages[id] || (overlayPages[id] = makeOverlayPage(id));
    if (!page.frame.getAttribute("src")) page.frame.setAttribute("src", page.url); // lazy load
    page.root.hidden = false;
    document.documentElement.classList.add("rpge-bridge-open");
}

function closeOverlayPage(id) {
    const page = overlayPages[id];
    if (!page) return;
    page.root.hidden = true; // keep the iframe alive
    document.documentElement.classList.remove("rpge-bridge-open");
}

function onPageClick(id) { return () => openOverlayPage(id); }
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
    openOverlayPage("bridge");
}

function onImportClick() {
    openOverlayPage("imports");
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
        // Escape closes any open page overlay (the game overlay has its own Close button).
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            for (const id of Object.keys(overlayPages)) {
                const p = overlayPages[id];
                if (p && p.root && !p.root.hidden) { closeOverlayPage(id); break; }
            }
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
