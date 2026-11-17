import init, {
    debug_menu_buttons,
    debug_write_user,
    debug_read_user,
    mount_exact,
    mount_file,
    mount_user_file,
    start_game,
} from "./pkg/osiris.js";
import { filesFromDrop, filesFromInput, filesUnder, findGameRoot } from "./folder.js";

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

async function loadFolder(list) {
    if (missionInvalid) {
        status.textContent = "mission must be a number";
        return;
    }

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

    // Everything under the root is mounted under /PharaohData, the folder `start_game`
    // looks for, so the game does not care how deep the root sat in the chosen folder.
    for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        const buf = await entry.file.arrayBuffer();
        mount_file("PharaohData/" + entry.path, new Uint8Array(buf));
        if (i % 50 === 0 || i === files.length - 1) {
            status.textContent = "Reading " + (i + 1) + " of " + files.length + " files...";
        }
    }

    try {
        startDiv.style.display = "none";
        canvas.hidden = false;
        // Set explicit dimensions so winit's canvas window is not 1×1.
        canvas.width = 1280;
        canvas.height = 768;
        canvas.style.width = "1280px";
        canvas.style.height = "768px";
        console.log("osiris web: set canvas to " + canvas.width + "x" + canvas.height);
        status.textContent = "Starting game...";
        start_game(mission);
    } catch (err) {
        console.error(err);
        startDiv.style.display = "flex";
        status.textContent = "Error: " + err.message;
    }
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
        startDiv.style.display = "flex";
    }
});
