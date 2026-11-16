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

/** Recursively collect all file paths under `root`. */
function walk(root, dir) {
    /** @type {string[]} */
    const result = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...walk(root, full));
        } else {
            result.push(path.relative(root, full));
        }
    }
    return result;
}

/** Filter to only essential game files needed to reach the main menu. */
function filterEssential(paths) {
    // Return all paths - we need everything for a proper test
    return paths;
}

/** Copy essential files into a temp directory under WEB_DIR for HTTP serving. */
function stageFiles(osirisData, relPaths) {
    const stagingDir = path.join(WEB_DIR, "game-data-staging");
    if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true });
    }

    for (const rel of relPaths) {
        const src = path.join(osirisData, rel);
        const dst = path.join(stagingDir, "PharaohData", rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
    }

    return stagingDir;
}

async function run() {
    await new Promise((resolve) => server.listen(PORT, resolve));

    try {
        // --use-angle=gl forces ANGLE to use OpenGL (WebGL2) so headless Chrome
        // actually renders WebGL content. Without it, the canvas is blank.
        // --no-sandbox is needed when running as root in CI containers.
        browser = await chromium.launch({
            args: ["--use-angle=gl", "--no-sandbox"],
        });
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
            return;
        }

        // ── Persistence smoke test (write, reload, read) ────────────
        await page.evaluate(async () => {
            debug_write_user("smoke.txt", "kept");
            await osirisStore.idle();
        });

        // Reload the page — same browser context keeps IndexedDB alive.
        consoleMessages.length = 0;
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });

        // Wait for the restored message (up to 15 s).
        const restoreDeadline = Date.now() + 15_000;
        let foundRestore = false;
        while (Date.now() < restoreDeadline) {
            await new Promise((r) => setTimeout(r, 200));
            for (const m of consoleMessages) {
                if (m.includes("osiris web: restored")) {
                    foundRestore = true;
                }
            }
            if (foundRestore) break;
        }

        // Print any new messages from the reload.
        for (const m of consoleMessages) {
            console.log(m);
        }

        if (!foundRestore) {
            console.error("FAIL: never saw 'osiris web: restored'");
            process.exitCode = 1;
        } else {
            // Read back the file — must be "kept".
            const value = await page.evaluate(() => debug_read_user("smoke.txt"));
            if (value !== "kept") {
                console.error("FAIL: user file not kept (got '" + value + "')");
                process.exitCode = 1;
            } else {
                console.log("osiris web: persist OK");
            }
        }

        // ── Game data smoke test (when OSIRIS_DATA is set) ────────────
        const osirisData = process.env.OSIRIS_DATA;
        if (osirisData && fs.existsSync(osirisData)) {
            console.log("osiris web: loading game data from " + osirisData);

            /** @type {string[]} */
            const allPaths = walk(osirisData, osirisData);
            const relPaths = filterEssential(allPaths);
            console.log("osiris web: " + allPaths.length + " total files, mounting " + relPaths.length + " essential");

            // Stage files on disk so the HTTP server can serve them.
            const stagingDir = stageFiles(osirisData, relPaths);
            console.log("osiris web: staged to " + stagingDir);

            // Mount all game files by fetching from the test server and using mount_file.
            // Use paths like "PharaohData/..." so mount_file creates /PharaohData/...
            await page.evaluate(async (paths) => {
                let count = 0;
                for (const rel of paths) {
                    const vfsPath = "PharaohData/" + rel;
                    const resp = await fetch("/game-data-staging/PharaohData/" + rel);
                    if (!resp.ok) {
                        console.error("Failed to fetch " + rel + ": " + resp.status);
                        continue;
                    }
                    const buf = new Uint8Array(await resp.arrayBuffer());
                    mount_file(vfsPath, buf);
                    count++;
                    if (count % 50 === 0) {
                        console.log("osiris web: mounted " + count + "/" + paths.length + " files");
                    }
                }
            }, relPaths);

            // Clean up staging directory.
            fs.rmSync(stagingDir, { recursive: true });

            console.log("osiris web: all essential game files mounted, starting game...");

            // Set canvas dimensions before starting the game (winit reads client_width/height).
            await page.evaluate(() => {
                const canvas = document.getElementById('osiris');
                if (canvas) {
                    canvas.width = 1280;
                    canvas.height = 768;
                    canvas.style.width = "1280px";
                    canvas.style.height = "768px";
                }
            });

            // Start the game — returns a Promise on wasm.
            await page.evaluate(() => start_game());

            // Wait for main menu (up to 300 s for large folders).
            const menuDeadline = Date.now() + 300_000;
            let foundMenu = false;
            while (Date.now() < menuDeadline) {
                await new Promise((r) => setTimeout(r, 500));
                for (const m of consoleMessages) {
                    if (m.includes("osiris web: main menu")) {
                        foundMenu = true;
                    }
                }
                if (foundMenu) break;
            }

            // Print any new messages.
            for (const m of consoleMessages) {
                console.log(m);
            }

            if (!foundMenu) {
                console.error("FAIL: never saw 'osiris web: main menu'");
                process.exitCode = 1;
            } else {
                // Give WebGL a moment to present the frame before capturing.
                await new Promise((r) => setTimeout(r, 500));

                // Read canvas pixels directly to verify rendering happened.
                const pixelInfo = await page.evaluate(() => {
                    const allCanvases = document.querySelectorAll('canvas');
                    let parts = [`canvases=${allCanvases.length}`];
                    for (const canvas of allCanvases) {
                        try {
                            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                            let info = `#${canvas.id}: ${canvas.width}x${canvas.height} style=${canvas.style.width}x${canvas.style.height}`;
                            if (gl) {
                                // Sample a grid of pixels to count distinct colors.
                                const w = canvas.width || 1280;
                                const h = canvas.height || 768;
                                const step = Math.max(1, Math.floor(Math.min(w, h) / 32));
                                const seen = new Set();
                                for (let y = 0; y < h; y += step) {
                                    for (let x = 0; x < w; x += step) {
                                        const pixels = new Uint8Array(4);
                                        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                                        seen.add(pixels[0] << 24 | pixels[1] << 16 | pixels[2] << 8 | pixels[3]);
                                    }
                                }
                                info += ` distinct=${seen.size}`;
                            }
                            parts.push(info);
                        } catch(e) {
                            parts.push(`#${canvas.id}: err=${e.message}`);
                        }
                    }
                    return parts.join('; ');
                });
                console.log("osiris web: canvas debug - " + pixelInfo);

                // Fail if the canvas is blank (too few distinct colors).
                const match = pixelInfo.match(/distinct=(\d+)/);
                if (match) {
                    const distinct = parseInt(match[1], 10);
                    if (distinct < 5) {
                        console.error("FAIL: canvas has only " + distinct + " distinct color(s), likely blank");
                        process.exitCode = 1;
                    } else {
                        console.log("osiris web: canvas OK (" + distinct + " distinct colors)");
                    }
                }

                // Take a screenshot.
                await page.screenshot({ path: "/tmp/osiris-web-menu.png", fullPage: false });
                console.log("osiris web: screenshot written to /tmp/osiris-web-menu.png");
            }
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
