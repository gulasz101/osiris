import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const WEB_DIR = path.resolve(import.meta.dirname, "..");
const PORT = 8765;

/** Serve static files from WEB_DIR. */
function createHandler() {
    return (req, res) => {
        let url = new URL(req.url, `http://localhost:${PORT}`);
        let filePath = path.join(WEB_DIR, url.pathname === "/" ? "index.html" : url.pathname.slice(1));

        const ext = path.extname(filePath).toLowerCase();
        const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json" };
        res.setHeader("Content-Type", types[ext] || "application/octet-stream");

        try {
            const data = fs.readFileSync(filePath);
            res.writeHead(200);
            res.end(data);
        } catch {
            res.writeHead(404);
            res.end("Not found");
        }
    };
}

const server = http.createServer(createHandler());

/** @type {string[]} */
const consoleMessages = [];
let browser, page;

async function run() {
    await new Promise((resolve) => server.listen(PORT, resolve));

    try {
        browser = await chromium.launch();
        page = await browser.newPage();

        page.on("console", (msg) => {
            consoleMessages.push(`[${msg.type().slice(0, 1)}] ${msg.text()}`);
        });

        try {
            await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        } catch {
            // Timeout is fine; we poll console messages below.
        }

        // Wait up to 30 s for the ready message or a panic.
        const deadline = Date.now() + 30_000;
        let foundReady = false;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 200));
            for (const m of consoleMessages) {
                if (m.includes("osiris web: ready")) {
                    foundReady = true;
                }
                if (m.toLowerCase().includes("panicked")) {
                    console.error("FATAL: wasm panic detected");
                    process.exitCode = 1;
                }
            }
            if (foundReady) break;
        }

        // Print all collected messages.
        for (const m of consoleMessages) {
            console.log(m);
        }

        if (!foundReady) {
            console.error("FAIL: never saw 'osiris web: ready'");
            process.exitCode = 1;
        }
    } finally {
        try {
            if (page) await page.close();
            if (browser) await browser.close();
        } catch { /* ignore cleanup errors */ }
        server.close();
    }
}

run().then(() => process.exit(process.exitCode || 0));
