import init, {
    debug_write_user,
    debug_read_user,
    mount_exact,
    mount_file,
    mount_user_file,
    start_game,
} from "./pkg/osiris.js";
import { filesFromInput } from "./folder.js";

const folderInput = document.getElementById("folder");
const startDiv = document.getElementById("start");
const canvas = document.getElementById("osiris");
const status = document.getElementById("status");

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
        start_game();
    } catch (err) {
        console.error(err);
        startDiv.style.display = "flex";
        status.textContent = "Error: " + err.message;
    }
}

folderInput.addEventListener("change", async () => {
    const files = [...folderInput.files];
    if (files.length === 0) return;
    await loadFolder(filesFromInput(folderInput.files));
});
