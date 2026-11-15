import init from "./pkg/osiris.js";

const folderInput = document.getElementById("folder");
const startDiv = document.getElementById("start");
const canvas = document.getElementById("osiris");
const status = document.getElementById("status");

try {
    await init();
    console.log("osiris web: ready");
} catch (err) {
    console.error(err);
    status.textContent = "Error: " + err.message;
}

folderInput.addEventListener("change", async () => {
    const files = [...folderInput.files];
    if (files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const buf = await file.arrayBuffer();
        mount_file(file.webkitRelativePath, new Uint8Array(buf));
        if (i % 50 === 0 || i === files.length - 1) {
            status.textContent = "Reading " + (i + 1) + " of " + files.length + " files...";
        }
    }

    try {
        startDiv.style.display = "none";
        canvas.hidden = false;
        status.textContent = "Starting game...";
        start_game();
    } catch (err) {
        console.error(err);
        startDiv.style.display = "flex";
        status.textContent = "Error: " + err.message;
    }
});
