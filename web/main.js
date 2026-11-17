import init, {
    debug_write_user,
    debug_read_user,
    mount_exact,
    mount_file,
    mount_user_file,
    start_game,
} from "./pkg/osiris.js";
import { filesFromDrop, filesFromInput } from "./folder.js";

let busy = false;

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
globalThis.debug_write_user = debug_write_user;
globalThis.debug_read_user = debug_read_user;
globalThis.mount_exact = mount_exact;
globalThis.mount_file = mount_file;
globalThis.mount_user_file = mount_user_file;
globalThis.start_game = start_game;

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

    console.log("osiris web: loading " + list.length + " files");

    for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        const buf = await entry.file.arrayBuffer();
        mount_file("/" + entry.path, new Uint8Array(buf));
        if (i % 50 === 0 || i === list.length - 1) {
            status.textContent = "Reading " + (i + 1) + " of " + list.length + " files...";
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
    await loadFolder(filesFromInput(folderInput.files));
});
