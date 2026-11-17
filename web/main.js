import init, {
    debug_menu_buttons,
    debug_write_user,
    debug_read_user,
    mount_exact,
    mount_file,
    mount_user_file,
    set_pick_time,
    start_game,
} from "./pkg/osiris.js";
import { filesFromDrop, filesFromInput, filesUnder, findGameRoot } from "./folder.js";
import { fitSize } from "./fit.js";
import { forget as forgetGameFiles, restore as restoreGameFiles, save as saveGameFiles } from "./opfs.js";
import { createBar, readAll } from "./progress.js";

let busy = false;

// The refusal `start_game` gives for a folder without the game, so the page can say it
// before it reads a single byte.
const NO_DATA_MESSAGE =
    "This folder does not hold Pharaoh's Data folder. Choose the folder that contains " +
    "Pharaoh.exe (the GOG or Steam installation of Pharaoh + Cleopatra).";

const folderInput = document.getElementById("folder");
const startDiv = document.getElementById("start");
const canvas = document.getElementById("osiris");
const status = document.getElementById("status");
const forgetButton = document.getElementById("forget");
const controls = document.getElementById("controls");
const fullscreenButton = document.getElementById("fullscreen");
const pageButton = document.getElementById("page");
// The bar over everything while the game files are read.
const progress = createBar(document.getElementById("progress"));

// `?mission=N` starts that mission straight away, as `osiris --mission N` does on the
// desktop. A value that is not a whole number is refused before the game starts.
const missionParam = new URLSearchParams(location.search).get("mission");
let mission = undefined;
if (missionParam !== null) {
    const n = Number(missionParam);
    if (Number.isInteger(n) && n >= 0) {
        mission = n;
    } else {
        console.error("osiris web: mission must be a number, got '" + missionParam + "'");
    }
}
const missionInvalid = missionParam !== null && mission === undefined;

// Expose wasm functions on window so the smoke test can call them via page.evaluate().
globalThis.debug_menu_buttons = debug_menu_buttons;
globalThis.debug_write_user = debug_write_user;
globalThis.debug_read_user = debug_read_user;
globalThis.mount_exact = mount_exact;
globalThis.mount_file = mount_file;
globalThis.mount_user_file = mount_user_file;
globalThis.start_game = start_game;
// The number `?mission=` gave, so the smoke test can check the URL reached the game.
globalThis.osirisMission = mission;

try {
    await init();
    // A visit that restores the game files from browser storage never picks a folder, so
    // the page loading is its start. A pick sets the clock again in `loadFolder`.
    set_pick_time(performance.now());
    console.log("osiris web: ready");
} catch (err) {
    console.error(err);
    status.textContent = "Error: " + err.message;
}

// Restore any persisted user files now that the wasm runtime is initialised.
try {
    await osirisStore.open();
    const stored = await osirisStore.loadAll();
    for (const [p, b] of stored) mount_user_file(p, b);
    console.log("osiris web: restored " + stored.length + " user files");
} catch (err) {
    console.warn("osiris web: persistence unavailable", err);
}

/**
 * Fill the window with the canvas, which is what the game is drawn on: its CSS size is the
 * window's and its bitmap is that size times the device pixel ratio. Winit's web backend
 * watches the canvas and reports the new size as a `Resized` event, which is how the game
 * learns to resize its surface.
 */
function fitCanvas() {
    const size = fitSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    canvas.style.width = size.width + "px";
    canvas.style.height = size.height + "px";
    // Assigning the bitmap size clears the canvas, so only do it when it really changes.
    if (canvas.width !== size.pixelWidth || canvas.height !== size.pixelHeight) {
        canvas.width = size.pixelWidth;
        canvas.height = size.pixelHeight;
    }
    console.log("osiris web: set canvas to " + canvas.width + "x" + canvas.height);
    return size;
}

/**
 * Show the canvas and start the game. The game files must be mounted already, either by
 * `loadFolder` from the player's folder or from the copy in browser storage.
 */
function start() {
    startDiv.style.display = "none";
    startDiv.hidden = true;
    canvas.hidden = false;
    // The canvas is the window, so winit's canvas window has the right size from the start.
    fitCanvas();
    // Only the game is on screen now, with these controls on top of it.
    if (controls) controls.hidden = false;
    status.textContent = "Starting game...";
    start_game(mission);
}

/**
 * Put the canvas in full screen, or leave it when the page is already there. The browser
 * only allows this from a real gesture, which the button and the F11 key provide; Escape
 * leaves full screen by itself.
 */
async function toggleFullscreen() {
    try {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        } else {
            await canvas.requestFullscreen();
        }
    } catch (err) {
        // A browser that refuses (no permission, no user gesture) says so; the game keeps
        // playing in the window.
        console.warn("osiris web: could not change full screen", err);
    }
}

if (fullscreenButton) {
    fullscreenButton.addEventListener("click", toggleFullscreen);
}

// F11 inside the page asks for full screen the same way the button does. The listener is on
// the document so it works wherever the keyboard focus is.
document.addEventListener("keydown", (event) => {
    if (event.key !== "F11" || canvas.hidden) return;
    event.preventDefault();
    toggleFullscreen();
});

/** Bring the start page back over the running game, or hide it again. */
function togglePage() {
    const showing = startDiv.classList.contains("over-game");
    if (showing) {
        startDiv.hidden = true;
        startDiv.classList.remove("over-game");
        startDiv.style.display = "none";
    } else {
        startDiv.hidden = false;
        startDiv.classList.add("over-game");
        startDiv.style.display = "flex";
    }
    if (pageButton) pageButton.textContent = showing ? "Page" : "Back to game";
}

if (pageButton) {
    pageButton.addEventListener("click", togglePage);
}

/** Put the start screen back and say what went wrong, leaving the page usable. */
function fail(err) {
    console.error(err);
    startDiv.hidden = false;
    startDiv.style.display = "flex";
    startDiv.classList.remove("over-game");
    if (controls) controls.hidden = true;
    canvas.hidden = true;
    status.textContent = "Error: " + (err && err.message ? err.message : err);
}

/** Offer the "Forget game files" button, which only makes sense once a copy exists. */
function showForget() {
    if (forgetButton) forgetButton.hidden = false;
}

// The game files the last load copied into browser storage: mount them and start, so the
// player never sees the picker twice for the same install.
let storedFiles = 0;
if (!missionInvalid) {
    try {
        storedFiles = await restoreGameFiles((path, bytes) => mount_file(path, bytes), progress);
    } catch (err) {
        console.warn("osiris web: reading the game files from browser storage failed", err);
    }
}
if (storedFiles > 0) {
    console.log("osiris web: game files restored from browser storage (" + storedFiles + " files)");
    status.textContent = "Restored " + storedFiles + " game files from browser storage.";
    try {
        start();
        showForget();
    } catch (err) {
        // A stored copy the game cannot use must never leave the player stuck on it.
        console.warn("osiris web: the stored game files cannot start the game, forgetting them", err);
        await forgetGameFiles();
        startDiv.hidden = false;
        startDiv.style.display = "flex";
        startDiv.classList.remove("over-game");
        if (controls) controls.hidden = true;
        canvas.hidden = true;
        status.textContent =
            "The game files kept in the browser cannot start the game. Choose your Pharaoh folder again.";
    }
}

if (forgetButton) {
    forgetButton.addEventListener("click", async () => {
        forgetButton.disabled = true;
        status.textContent = "Forgetting the game files...";
        await forgetGameFiles();
        location.reload();
    });
}

// A window change resizes the canvas the same way the start did; winit's resize observer
// turns the new CSS size into a `Resized` event, and the game resizes its surface with it.
window.addEventListener("resize", () => {
    if (!canvas.hidden) fitCanvas();
});

// Leaving full screen has the browser lay the page out again, and winit puts back the
// windowed size it remembered, so the canvas is fitted to the window once more.
document.addEventListener("fullscreenchange", () => {
    if (canvas.hidden) return;
    // The page has not been laid out for the new screen size yet when this fires.
    requestAnimationFrame(() => {
        if (!canvas.hidden) fitCanvas();
    });
});

/**
 * Copy the picked game files into browser storage for the next load. Runs on its own
 * after the game has started, so it never holds the start up, and never fails it.
 */
async function copyToStorage(files) {
    try {
        if ((await saveGameFiles(files)) > 0) showForget();
    } catch (err) {
        console.warn("osiris web: keeping the game files in browser storage failed", err);
    }
}

async function loadFolder(list) {
    if (missionInvalid) {
        status.textContent = "mission must be a number";
        return;
    }

    // The game logs how long it took from here to its main menu, and the number is only
    // meaningful if the clock starts at the pick rather than at the page loading.
    set_pick_time(performance.now());

    // The game root is wherever inside the chosen folder `Data/Pharaoh_General.sg3` is,
    // so the player may pick the GOG folder or any folder above the game files.
    const root = findGameRoot(list);
    if (root === null) {
        console.log(
            "osiris web: no Data/Pharaoh_General.sg3 among " + list.length + " files, refusing the folder"
        );
        status.textContent = NO_DATA_MESSAGE;
        return;
    }
    const files = filesUnder(root, list);

    console.log(
        "osiris web: game root '" + (root || "(the chosen folder)") + "', reading " +
        files.length + " of " + list.length + " files"
    );

    const started = performance.now();

    // Everything under the root is mounted under /PharaohData, the folder `start_game`
    // looks for, so the game does not care how deep the root sat in the chosen folder.
    // The bar says how far the read has got, and `readAll` keeps eight reads going at the
    // same time; `design.md` records that this is the faster of the two measured ways.
    await readAll(
        files,
        (entry) => entry.file.arrayBuffer(),
        (entry, bytes) => mount_file("PharaohData/" + entry.path, new Uint8Array(bytes)),
        progress
    );
    console.log(
        "osiris web: read " + files.length + " files in " +
        Math.round(performance.now() - started) + " ms"
    );

    try {
        start();
    } catch (err) {
        fail(err);
        return;
    }

    // The game is running; keep these files for the next load. Not awaited: the copy runs
    // file by file while the game draws, and its progress goes to the console.
    copyToStorage(files);
}

// Drag-and-drop handlers on the start div.
startDiv.addEventListener("dragover", e => {
    e.preventDefault();
    startDiv.classList.add("drag");
});

startDiv.addEventListener("dragleave", () => {
    startDiv.classList.remove("drag");
});

startDiv.addEventListener("drop", async e => {
    e.preventDefault();
    startDiv.classList.remove("drag");
    if (busy) return;
    busy = true;
    try {
        await loadFolder(await filesFromDrop(e.dataTransfer));
    } finally {
        busy = false;
    }
});

folderInput.addEventListener("change", async () => {
    const files = [...folderInput.files];
    if (files.length === 0) return;
    try {
        await loadFolder(filesFromInput(folderInput.files));
    } catch (err) {
        // A file the browser cannot read any more (the folder moved or was deleted while
        // the page was reading it) must say so in the status line, not sit there silently.
        console.error("osiris web: reading the chosen folder failed", err);
        status.textContent = "Error: " + err.message;
        startDiv.hidden = false;
        startDiv.style.display = "flex";
        startDiv.classList.remove("over-game");
        if (controls) controls.hidden = true;
    }
});
