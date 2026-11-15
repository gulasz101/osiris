import init from "./pkg/osiris.js";

const status = document.getElementById("status");

try {
    await init();
    status.textContent = "Ready.";
} catch (err) {
    console.error(err);
    status.textContent = "Error: " + err.message;
}
