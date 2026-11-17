import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const WEB_DIR = path.resolve(process.env.SMOKE_ROOT ?? path.resolve(import.meta.dirname, ".."));
// URL prefix the site is served under. GitHub Pages serves us at /osiris/, so the
// smoke test can prove the page works there without a local GitHub Pages.
const BASE = process.env.SMOKE_BASE ?? "/";
if (!BASE.startsWith("/") || !BASE.endsWith("/")) {
    console.error("FAIL: SMOKE_BASE must start and end with '/' (got " + BASE + ")");
    process.exit(1);
}
const PORT = 8765;
// `direct` starts mission 3 through `?mission=3` as soon as the files are mounted; `menu`
// walks the main menu with real clicks. Empty (the default) keeps the old run.
const MISSION_MODE = (process.env.SMOKE_MISSION ?? "").trim();
if (!["", "direct", "menu"].includes(MISSION_MODE)) {
    console.error("FAIL: SMOKE_MISSION must be empty, 'direct' or 'menu' (got " + MISSION_MODE + ")");
    process.exit(1);
}
// `1` takes a saved game out of the browser and back: it starts the menu mission's city
// (so it walks the menu as `SMOKE_MISSION=menu` does), saves it, and works the Saves panel.
const SAVES_RAW = (process.env.SMOKE_SAVES ?? "").trim();
const SAVES = SAVES_RAW === "1";
if (SAVES_RAW !== "" && !SAVES) {
    console.error("FAIL: SMOKE_SAVES must be 1 or unset (got " + SAVES_RAW + ")");
    process.exit(1);
}
// `1` runs the soak change's three runs in one session: 24 months of mission 0 at the
// fastest speed, 6 months of a custom map, and the Mission Editor saving an edit. The
// numbers it records are in `design.md`.
const SOAK_RAW = (process.env.SMOKE_SOAK ?? "").trim();
const SOAK = SOAK_RAW === "1";
if (SOAK_RAW !== "" && !SOAK) {
    console.error("FAIL: SMOKE_SOAK must be 1 or unset (got " + SOAK_RAW + ")");
    process.exit(1);
}
// `1` runs on the host's real GPU (web-gpu-fps): Chrome gets the Metal flags instead of
// the software-safe ones, and the run fails if the page still drew with a software
// adapter. `SMOKE_HEADED=1` also opens a window, for a host where headless gets no GPU.
const GPU_RAW = (process.env.SMOKE_GPU ?? "").trim();
const GPU = GPU_RAW === "1";
if (GPU_RAW !== "" && !GPU) {
    console.error("FAIL: SMOKE_GPU must be 1 or unset (got " + GPU_RAW + ")");
    process.exit(1);
}
const HEADED_RAW = (process.env.SMOKE_HEADED ?? "").trim();
const HEADED = HEADED_RAW === "1";
if (HEADED_RAW !== "" && !HEADED) {
    console.error("FAIL: SMOKE_HEADED must be 1 or unset (got " + HEADED_RAW + ")");
    process.exit(1);
}

// `SMOKE_TRACE=<file>` records a Chrome performance trace of 20 s of the running city at the
// fastest speed, on the soak run's own path, and writes it to `<file>` (web-frame-trace). The
// file belongs outside the repo: a trace is evidence for a report, never a committed file.
const TRACE_FILE = (process.env.SMOKE_TRACE ?? "").trim();
const TRACE = TRACE_FILE !== "";

const DIRECT = MISSION_MODE === "direct";const MENU = MISSION_MODE === "menu" || SAVES || SOAK || TRACE;
// `intro` plays the original's intro movie in the browser and skips it with Escape.
const MOVIE_MODE = (process.env.SMOKE_MOVIE ?? "").trim();
if (!["", "intro"].includes(MOVIE_MODE)) {
    console.error("FAIL: SMOKE_MOVIE must be empty or 'intro' (got " + MOVIE_MODE + ")");
    process.exit(1);
}
const INTRO = MOVIE_MODE === "intro";
// `outer/inner` puts the game files two folders deeper inside the staged folder, as
// Wojtek's GOG install does, and reads them through the page's own folder picker. That
// proves the page finds the game root instead of assuming the chosen folder is it.
const WRAP = (process.env.SMOKE_WRAP ?? "").trim().replace(/^\/+|\/+$/g, "");
if (WRAP !== "" && !WRAP.split("/").every((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..")) {
    console.error("FAIL: SMOKE_WRAP must be folder names separated by '/', like outer/inner (got " + WRAP + ")");
    process.exit(1);
}
// `1` proves the page remembers the game files: it reads them through the page's own
// picker, waits for the copy into the browser's own storage, reloads the page in the same
// browser profile and expects the main menu with no picker.
const REMEMBER_RAW = (process.env.SMOKE_REMEMBER ?? "").trim();
const REMEMBER = REMEMBER_RAW === "1";
if (REMEMBER_RAW !== "" && !REMEMBER) {
    console.error("FAIL: SMOKE_REMEMBER must be 1 or unset (got " + REMEMBER_RAW + ")");
    process.exit(1);
}
if (REMEMBER && (DIRECT || MENU || INTRO || WRAP !== "")) {
    console.error("FAIL: SMOKE_REMEMBER runs on its own, with no SMOKE_MISSION, SMOKE_MOVIE or SMOKE_WRAP");
    process.exit(1);
}
// The wrapped run starts the game from the page's own picker as soon as the files are
// read, so the menu modes (which click and press keys before starting) do not apply.
if (WRAP !== "" && (INTRO || MENU)) {
    console.error("FAIL: SMOKE_WRAP runs with no SMOKE_MISSION or SMOKE_MISSION=direct");
    process.exit(1);
}
// `1920x1080` opens the page in a window of that size and starts the game through the page's
// own picker, so `main.js` is what sizes the canvas. The run then checks that the canvas is
// the window, that the game resized its surface to it, that the city fills the frame, and
// that a smaller window is filled too.
// Comma-separated values like `1366x630,800x600,1920x1080` test each size in sequence.
const VIEWPORT_RAW = (process.env.SMOKE_VIEWPORT ?? "").trim();
let VIEWPORT = null;
if (VIEWPORT_RAW !== "") {
    const sizes = VIEWPORT_RAW.split(",");
    VIEWPORT = [];
    for (const raw of sizes) {
        const match = /^(\d{2,5})x(\d{2,5})$/.exec(raw.trim());
        if (!match) {
            console.error("FAIL: SMOKE_VIEWPORT must be WIDTHxHEIGHT like 1920x1080 (got " + raw.trim() + ")");
            process.exit(1);
        }
        VIEWPORT.push({ width: Number(match[1]), height: Number(match[2]) });
    }
}
if ((VIEWPORT?.length ?? 0) > 0 && !MENU) {
    console.error("FAIL: SMOKE_VIEWPORT runs with SMOKE_MISSION=menu");
    process.exit(1);
}
if ((VIEWPORT?.length ?? 0) > 0 && (INTRO || WRAP !== "" || REMEMBER)) {
    console.error("FAIL: SMOKE_VIEWPORT runs on its own, with no SMOKE_MOVIE, SMOKE_WRAP or SMOKE_REMEMBER");
    process.exit(1);
}
// `1` hands the staged files to the page's own folder picker, so the page's reading path
// (its progress bar and its read time) is what runs, and then goes on with the ordinary
// checks. `design.md` records the numbers this mode measured.
const PICK_RAW = (process.env.SMOKE_PICK ?? "").trim();
const PICK_MODE = PICK_RAW === "1";
if (PICK_RAW !== "" && !PICK_MODE) {
    console.error("FAIL: SMOKE_PICK must be 1 or unset (got " + PICK_RAW + ")");
    process.exit(1);
}
if (PICK_MODE && REMEMBER) {
    console.error("FAIL: SMOKE_PICK runs with no SMOKE_REMEMBER, which reads the picker itself");
    process.exit(1);
}
// The game is started by the page itself in a wrapped, viewport or picker run.
const PICK = WRAP !== "" || (VIEWPORT?.length ?? 0) > 0 || PICK_MODE;
if (SAVES && (DIRECT || INTRO || WRAP !== "" || REMEMBER || (VIEWPORT?.length ?? 0) > 0 || PICK_MODE)) {
    console.error("FAIL: SMOKE_SAVES runs with no SMOKE_MISSION, SMOKE_MOVIE, SMOKE_WRAP, SMOKE_REMEMBER, SMOKE_VIEWPORT or SMOKE_PICK");
    process.exit(1);
}
// `1` proves the page reads a registered `File` synchronously on the main thread, which
// is how `files.js` gives the game a file it never copied into memory (`web-lazy`). It
// builds a 40 MB file in the page, registers it and reads it back, so it needs no game
// data at all and runs on its own.
const SYNCREAD_RAW = (process.env.SMOKE_SYNCREAD ?? "").trim();
const SYNCREAD = SYNCREAD_RAW === "1";
if (SYNCREAD_RAW !== "" && !SYNCREAD) {
    console.error("FAIL: SMOKE_SYNCREAD must be 1 or unset (got " + SYNCREAD_RAW + ")");
    process.exit(1);
}
if (SYNCREAD && (DIRECT || MENU || INTRO || WRAP !== "" || REMEMBER || (VIEWPORT?.length ?? 0) > 0 || PICK_MODE)) {
    console.error("FAIL: SMOKE_SYNCREAD runs on its own, with no SMOKE_MISSION, SMOKE_MOVIE, SMOKE_WRAP, SMOKE_REMEMBER, SMOKE_VIEWPORT or SMOKE_PICK");
    process.exit(1);
}
// A trace run walks the menu to a city the way the soak does, so it runs on its own too.
if (TRACE && (MISSION_MODE !== "" || SAVES || INTRO || WRAP !== "" || REMEMBER || (VIEWPORT?.length ?? 0) > 0 || PICK_MODE || SYNCREAD)) {
    console.error("FAIL: SMOKE_TRACE runs on its own, with no SMOKE_MISSION, SMOKE_SAVES, SMOKE_MOVIE, SMOKE_WRAP, SMOKE_REMEMBER, SMOKE_VIEWPORT, SMOKE_PICK or SMOKE_SYNCREAD");
    process.exit(1);
}

// Every request the page made, so a missing file shows up instead of hiding
// behind a blank page.
/** @type {string[]} */
const requestLog = [];

/** Serve static files from WEB_DIR, under BASE. */
function createHandler() {
    return (req, res) => {
        const url = new URL(req.url, `http://localhost:${PORT}`);

        // A request outside BASE is a 404, exactly as GitHub Pages would answer.
        if (!url.pathname.startsWith(BASE)) {
            requestLog.push(`404 ${url.pathname} (outside ${BASE})`);
            res.writeHead(404);
            res.end("Not found");
            return;
        }

        let rel = decodeURIComponent(url.pathname.slice(BASE.length));
        if (rel === "" || rel.endsWith("/")) rel = path.join(rel, "index.html");
        const filePath = path.join(WEB_DIR, rel);

        // Refuse anything that climbs out of WEB_DIR.
        const inside = path.relative(WEB_DIR, filePath);
        if (inside.startsWith("..") || path.isAbsolute(inside)) {
            requestLog.push(`404 ${url.pathname} (leaves the served folder)`);
            res.writeHead(404);
            res.end("Not found");
            return;
        }

        // The page names no favicon; answer quietly so the log stays readable.
        if (path.basename(filePath) === "favicon.ico") {
            res.writeHead(204);
            res.end();
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json" };
        res.setHeader("Content-Type", types[ext] || "application/octet-stream");

        try {
            const data = fs.readFileSync(filePath);
            requestLog.push(`200 ${url.pathname}`);
            res.writeHead(200);
            res.end(data);
        } catch {
            requestLog.push(`404 ${url.pathname}`);
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
function stageFiles(osirisData, relPaths, wrap = "") {
    const stagingDir = path.join(WEB_DIR, "game-data-staging");
    if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true });
    }

    for (const rel of relPaths) {
        const src = path.join(osirisData, rel);
        const dst = path.join(stagingDir, wrap, "PharaohData", rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
    }

    return stagingDir;
}

/**
 * Click a menu button and wait for the page it opens. The click is sent again if the page
 * does not change within `ms`, since a frame boundary can swallow one.
 */
async function clickMenuTo(prefix, pageName, { last = false, ms = 15_000 } = {}) {
    for (let tries = 0; tries < 3; tries += 1) {
        const from = consoleMessages.length;
        await clickMenu(prefix, last);
        if (await waitPage(pageName, ms, from)) return true;
    }
    return false;
}

/** Wait until `predicate()` is true, or `ms` runs out. Returns whether it became true. */
async function until(predicate, ms, step = 250) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, step));
    }
    return predicate();
}

/**
 * Watch `#progress` from before the picker is given the folder: every line the bar shows
 * is kept in the page, so a read that finishes between two polls still leaves proof that
 * the bar was up.
 */
async function watchProgress() {
    await page.evaluate(() => {
        const element = document.getElementById("progress");
        globalThis.osirisProgressSeen = [];
        const note = () => {
            if (!element || element.hidden) return;
            const text = document.getElementById("progress-text");
            if (text && text.textContent) globalThis.osirisProgressSeen.push(text.textContent);
        };
        note();
        new MutationObserver(note).observe(element, {
            attributes: true, childList: true, subtree: true, characterData: true,
        });
    });
}

/** One line of the bar: `Reading game files: 412 / 1335 (31%)`. */
const BAR_LINE = /^Reading game files: (\d+) \/ (\d+) \(\d+%\)$/;

/**
 * Take `/tmp/osiris-web-loading.png` while the bar is up, and say what the bar read.
 * Returns `{ text, bytes }` when the shot has the bar on it, `{ text, seen, gone }` when
 * the read finished before the shot could be taken, and null when the bar never appeared.
 */
async function captureLoading(shotFile) {
    const deadline = Date.now() + 300_000;
    let shownAt = 0;
    while (Date.now() < deadline) {
        const state = await page.evaluate(() => {
            const element = document.getElementById("progress");
            const text = document.getElementById("progress-text");
            return {
                shown: !!element && !element.hidden,
                text: text ? text.textContent : "",
                seen: globalThis.osirisProgressSeen ?? [],
            };
        });
        const hit = BAR_LINE.exec(state.text);
        if (hit && state.shown) {
            if (!shownAt) shownAt = Date.now();
            // Shoot as soon as the bar has moved off zero (its first repaint, 100 ms in),
            // or after half a second if it has not, so the shot always has the bar on it.
            if (Number(hit[1]) > 0 || Date.now() - shownAt >= 500) {
                await page.screenshot({ path: shotFile, fullPage: false });
                return { text: state.text, bytes: fs.statSync(shotFile).size };
            }
        } else if (state.seen.length > 0) {
            // Hidden again after it had drawn: the read beat the shot.
            return { text: state.seen[state.seen.length - 1], seen: state.seen, gone: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
}

/**
 * Whether a run that reached the main menu also logged how long the start took:
 * `osiris web: menu after N ms`, where `N` counts from the pick (or from the page loading
 * when the files came from browser storage).
 */
function checkMenuTime() {
    const line = consoleMessages.find((m) => m.includes("osiris web: menu after "));
    const ms = Number(/osiris web: menu after (\d+) ms/.exec(line ?? "")?.[1] ?? NaN);
    if (!Number.isFinite(ms)) {
        console.error("FAIL: the main menu came up without 'osiris web: menu after N ms'");
        return false;
    }
    console.log("osiris web: menu time OK (" + ms + " ms from the pick to the main menu)");
    return true;
}

/** The distinct `osiris web: city month <n>` values in the console log, in order. */
function monthsSeen() {
    const months = [];
    for (const message of consoleMessages) {
        const hit = message.match(/osiris web: city month (\d+)/);
        if (hit && !months.includes(hit[1])) months.push(hit[1]);
    }
    return months;
}

/** The first console line that looks like a wasm panic, or null. */
function panicLine() {
    return consoleMessages.find((message) => message.toLowerCase().includes("panicked")) ?? null;
}

/**
 * The graphics backend and adapter the page started with, from its own line
 * `osiris web: gfx backend <WebGPU|WebGL2> adapter <name>` (web-gpu-fps), or null
 * when the page logged none.
 */
function gfxAdapter() {
    for (const message of consoleMessages) {
        const hit = message.match(/osiris web: gfx backend (\S+) adapter (.+)/);
        if (hit) return { backend: hit[1].trim(), adapter: hit[2].trim() };
    }
    return null;
}

/**
 * Say which graphics backend and adapter the page drew with, once every run. The page logs
 * it when the game's graphics start, so this waits for a flow to have started the game.
 * With `SMOKE_GPU=1` a missing line and a software adapter both fail the run: the numbers
 * of a software adapter say nothing about a player's machine (web-gpu-fps design 2).
 */
function reportGfx() {
    const gfx = gfxAdapter();
    if (gfx) console.log("osiris web: gfx backend " + gfx.backend + " adapter " + gfx.adapter);
    if (!GPU) return;
    if (!gfx) {
        console.error("FAIL: GPU run logged no gfx adapter line");
        process.exitCode = 1;
        return;
    }
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(gfx.adapter)) {
        console.error("FAIL: GPU run got a software adapter: " + gfx.adapter);
        process.exitCode = 1;
        return;
    }
    console.log("osiris web: GPU run OK on " + gfx.adapter + " via " + gfx.backend);
}

/**
 * SMOKE_MISSION=direct: the page was loaded with `?mission=3` and the game files are
 * mounted, so start the game with the mission main.js read out of the URL and check
 * the city really runs. Two different months prove the simulation advanced; the
 * screenshot must be a real frame (a blank canvas compresses far below 50 000 bytes).
 */
async function runDirectMission({ alreadyStarted = false } = {}) {
    // main.js exposes the parsed value, so this also proves `?mission=3` reached the page.
    const mission = await page.evaluate(() => globalThis.osirisMission);
    if (mission !== 3) {
        console.error("FAIL: ?mission=3 did not reach main.js (got " + mission + ")");
        process.exitCode = 1;
        return;
    }

    // The wrapped run hands the folder to the page's picker, which starts the game
    // itself; starting it a second time would run the program twice.
    if (!alreadyStarted) {
        await page.evaluate((m) => start_game(m), mission);
    }
    const started = await until(
        () => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: city 3 started")),
        300_000,
        500
    );

    // A mission opens its briefing and a message when it starts, and the game stops
    // ticking while either is open. Escape closes whatever is up, as a player would, so
    // press it now and then and let the city run. Months turn every 16 days of 51 ticks,
    // so give it the same 300 s a menu load gets.
    // Give the canvas the keyboard (a click focuses it, as winit's web canvas needs), then
    // raise the game speed so months turn quickly.
    if (started) {
        await page.mouse.click(640, 384);
        for (let i = 0; i < 6; i += 1) await page.keyboard.press("BracketRight");
    }

    let twoMonths = started;
    let dismissed = 0;
    const deadline = Date.now() + 300_000;
    while (twoMonths && monthsSeen().length < 2 && Date.now() < deadline) {
        if (panicLine() !== null) break;
        await page.keyboard.press("Escape");
        dismissed += 1;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    twoMonths = twoMonths && monthsSeen().length >= 2;
    console.log("osiris web: pressed Escape " + dismissed + " times to close the mission's screens");

    for (const message of consoleMessages) console.log(message);

    // Give WebGL a moment to present the last frame before capturing it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: "/tmp/osiris-web-city.png", fullPage: false });
    const shot = fs.statSync("/tmp/osiris-web-city.png").size;
    console.log("osiris web: screenshot written to /tmp/osiris-web-city.png (" + shot + " bytes)");

    const panic = panicLine();
    const months = monthsSeen();
    if (panic) {
        console.error("FATAL: wasm panic detected: " + panic);
        process.exitCode = 1;
    } else if (!started) {
        console.error("FAIL: never saw 'osiris web: city 3 started'");
        process.exitCode = 1;
    } else if (!twoMonths || months.length < 2) {
        console.error("FAIL: the city did not run two months (saw " + JSON.stringify(months) + ")");
        process.exitCode = 1;
    } else if (shot < 50_000) {
        console.error("FAIL: the city screenshot is only " + shot + " bytes, likely blank");
        process.exitCode = 1;
    } else {
        console.log("osiris web: city started and ran " + months.length + " months: " + months.join(", "));
    }
}

/**
 * Press the title screen's "Enter the game" button once the page shows it, which it does
 * when it knows the game files (a pick or the copy in browser storage). Then wait for the
 * loading screen the press puts up. Returns false when the button never came.
 */
async function enterGame() {
    try {
        await page.waitForSelector("#enter", { state: "visible", timeout: 120_000 });
        await page.click("#enter");
        await page.waitForSelector("#loading", { state: "visible", timeout: 10_000 }).catch(() => {
            /* a very fast start may take the loading screen down before this looks */
        });
        console.log("osiris web: pressed Enter the game");
        return true;
    } catch (err) {
        console.error("osiris web: no Enter button: " + err.message);
        return false;
    }
}

/**
 * SMOKE_REMEMBER=1: the page keeps the game files. Read them through the page's own picker
 * (the copy needs the File objects a pick gives it), wait for the copy into the browser's
 * own storage, reload the page in the same browser profile, and expect the main menu with
 * no picker and the same number of files.
 */
async function runRemember(stagingDir) {
    const pickFailure = (err) => {
        console.error("FAIL: could not give the picker " + stagingDir + ": " + err.message);
        process.exitCode = 1;
    };
    await page.setInputFiles("#folder", stagingDir).catch(pickFailure);
    if (process.exitCode === 1) return;

    const copiedLine = (messages) =>
        messages.find((m) => m.includes("osiris web: game files copied to browser storage ("));
    const copied = await until(
        () => panicLine() !== null || copiedLine(consoleMessages) !== undefined,
        600_000,
        500
    );
    for (const m of consoleMessages) console.log(m);
    const copiedCount = Number(/\((\d+) files\)/.exec(copiedLine(consoleMessages) ?? "")?.[1] ?? 0);
    if (panicLine() !== null) {
        console.error("FATAL: wasm panic detected: " + panicLine());
        process.exitCode = 1;
        return;
    }
    if (!copied || copiedCount === 0) {
        console.error("FAIL: the page never copied the game files into browser storage");
        fs.rmSync(stagingDir, { recursive: true, force: true });
        process.exitCode = 1;
        return;
    }

    // The copy has the bytes; the staged folder can go before the reload on purpose, so the
    // restored run cannot read the game anywhere but the browser's own storage.
    fs.rmSync(stagingDir, { recursive: true, force: true });
    consoleMessages.length = 0;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {
        /* the restore line is polled below */
    });

    const restoredLine = () =>
        consoleMessages.find((m) => m.includes("osiris web: game files restored from browser storage ("));
    const restored = await until(
        () => panicLine() !== null || restoredLine() !== undefined,
        600_000,
        500
    );
    const restoredCount = Number(/\((\d+) files\)/.exec(restoredLine() ?? "")?.[1] ?? 0);
    // A restored visit waits on the title screen with "Enter the game"; no picker needed.
    const entered = restored && (await enterGame());
    if (restored && !entered) {
        console.error("FAIL: the title screen never offered 'Enter the game' after the restore");
        process.exitCode = 1;
        return;
    }
    const menu = await until(
        () => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: main menu")),
        600_000,
        500
    );
    for (const m of consoleMessages) console.log(m);

    // No picker this time: the file input is empty and the start screen is gone.
    const picker = await page.evaluate(() => ({
        files: document.getElementById("folder").files.length,
        start: getComputedStyle(document.getElementById("start")).display,
    }));

    const panic = panicLine();
    if (panic) {
        console.error("FATAL: wasm panic detected: " + panic);
        process.exitCode = 1;
    } else if (!restored || restoredCount !== copiedCount) {
        console.error(
            "FAIL: the page restored " + restoredCount + " of the " + copiedCount + " stored game files"
        );
        process.exitCode = 1;
    } else if (picker.files !== 0 || picker.start !== "none") {
        console.error("FAIL: the folder picker was still on screen after the restore (" + JSON.stringify(picker) + ")");
        process.exitCode = 1;
    } else if (!menu) {
        console.error("FAIL: never saw 'osiris web: main menu' after restoring the game files");
        process.exitCode = 1;
    } else if (!checkMenuTime()) {
        process.exitCode = 1;
    } else {
        console.log("osiris web: remember OK (" + restoredCount + " files)");
    }
}

/** The buttons of the menu page drawn last, as the browser build reports them. */
async function menuButtons() {
    const json = await page.evaluate(() => (typeof debug_menu_buttons === "function" ? debug_menu_buttons() : "[]"));
    try {
        return JSON.parse(json);
    } catch {
        return [];
    }
}

/** Where the canvas sits in the page, so a menu rect becomes a page coordinate. */
async function canvasOrigin() {
    return page.evaluate(() => {
        const canvas = document.getElementById("osiris");
        const r = canvas.getBoundingClientRect();
        return { left: r.left, top: r.top };
    });
}

/** Waits until the menu reports `osiris web: page <name>`, after the `from`th console line. */
function waitPage(name, ms = 60_000, from = 0) {
    return until(() => consoleMessages.slice(from).some((m) => m.includes("osiris web: page " + name)), ms, 250);
}

/**
 * Clicks the first menu button whose action starts with `prefix`, the way a player
 * would: read the button's rect, add the canvas's place in the page, click its centre.
 */
async function clickMenu(prefix, last = false) {
    // The buttons are recorded as the page is drawn, so a page the game has just changed
    // to may still report the one before it: wait for the button to turn up.
    let hit = null;
    const deadline = Date.now() + 15_000;
    while (!hit && Date.now() < deadline) {
        const matching = (await menuButtons()).filter((b) => b.action.startsWith(prefix));
        if (matching.length > 0) hit = last ? matching[matching.length - 1] : matching[0];
        else await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!hit) {
        const buttons = await menuButtons();
        throw new Error("no menu button starts with " + JSON.stringify(prefix) + "; the page has " + JSON.stringify(buttons.map((b) => b.action)));
    }
    const origin = await canvasOrigin();
    await page.mouse.click(origin.left + hit.x + hit.w / 2, origin.top + hit.y + hit.h / 2);
    console.log("osiris web: clicked " + hit.action + " (" + hit.label + ")");
    return hit;
}

/**
 * The intro plays before the main menu on a fresh start. A player skips it with Escape,
 * so every later mode that expects the menu has to get past it first. Returns false when
 * the intro never starts, which is fine: the menu is then simply already there.
 */
async function skipIntro() {
    const seen = await until(
        () => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: movie Intro_big started")),
        30_000,
        100
    );
    if (!seen) return false;
    const mark = consoleMessages.length;
    await page.keyboard.press("Escape");
    const done = await until(
        () => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: movie Intro_big done")),
        30_000,
        100
    );
    for (const m of consoleMessages.slice(mark)) console.log(m);
    if (!done) {
        console.error("FAIL: Escape did not skip the intro on the way to the menu");
        process.exitCode = 1;
    } else {
        console.log("osiris web: Escape skipped the intro on the way to the menu");
    }
    return done;
}

/**
 * SMOKE_MISSION=menu: start a mission from the menu, the way the player does. Creates a
 * family in the registry, goes to the campaign, picks the first mission and its briefing,
 * then lets the city run. Two different months prove the simulation advanced.
 */
/**
 * Walks the menu to a city: the intro, a new family named `family`, its family history,
 * the first mission, its briefing, and the click that starts the city. `runMenuMission`
 * and the soak run both begin here. A failure sets `process.exitCode` and returns false.
 */
async function enterFirstMission(family) {
    // The intro is the first screen of a fresh start, so it is in the way here too.
    await skipIntro();
    if (!checkMenuTime()) process.exitCode = 1;
    const registryPage = await waitPage("family", 60_000, 0);
    if (!registryPage) {
        console.error("FAIL: the registry page never came up");
        process.exitCode = 1;
        return false;
    }
    const registry = await menuButtons();
    console.log("osiris web: the registry offers " + JSON.stringify(registry.slice(0, 2)));

    // A new family, named by typing as a player would.
    let from = consoleMessages.length;
    if (!(await clickMenuTo("Go(NewFamily)", "newfamily", { ms: 30_000 }))) {
        console.error("FAIL: the new family page never came up");
        process.exitCode = 1;
        return false;
    }
    from = consoleMessages.length;
    await page.keyboard.type(family);
    await page.keyboard.press("Enter");
    if (!(await waitPage("family", 60_000, from))) {
        console.error("FAIL: the registry never came back after naming the family");
        process.exitCode = 1;
        return false;
    }

    // The family's own file proves the typed name reached the game.
    const made = await page.evaluate((name) => debug_read_user("families/" + name + "/name.txt"), family.toLowerCase());
    console.log("osiris web: the family's name.txt reads " + JSON.stringify(made ?? null));

    // Pick the family just made and go on to its menu.
    from = consoleMessages.length;
    await clickMenu('Choose(Family("');
    await clickMenu("Choose(Family", true);
    if (!(await waitPage("main", 60_000, from))) {
        console.error("FAIL: the family's menu never came up after choosing it");
        for (const m of consoleMessages) console.log(m);
        process.exitCode = 1;
        return false;
    }

    // The family history's mission list. Explore History's tab opens it directly, which is
    // the way to a mission that does not play the period's opening movie first.
    if (!(await clickMenuTo("Go(HistoryPeriods)", "historyperiods")) || !(await clickMenuTo("Go(Campaign)", "campaign"))) {
        console.error("FAIL: the campaign's mission list never came up");
        for (const m of consoleMessages) console.log(m);
        process.exitCode = 1;
        return false;
    }
    // The campaign's first mission, and its briefing: a click on the row picks it and the
    // list's arrow starts it.
    await clickMenu("Choose(Mission");
    if (!(await clickMenuTo("Choose(StartMission)", "briefing", { ms: 60_000 }))) {
        console.error("FAIL: the briefing never came up");
        process.exitCode = 1;
        return false;
    }

    // On to the city. A mission opens messages when it starts, and the game stands still
    // while one is up, so press Escape now and then and let the city run.
    from = consoleMessages.length;
    await clickMenu("ToCity");
    return true;
}

async function runMenuMission() {
    if (!(await enterFirstMission("Smoke"))) return;
    let twoMonths = await until(() => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: city ")), 120_000, 500);
    if (twoMonths) {
        await page.mouse.click((await canvasOrigin()).left + 640, (await canvasOrigin()).top + 384);
        for (let i = 0; i < 6; i += 1) await page.keyboard.press("BracketRight");
    }
    let dismissed = 0;
    const deadline = Date.now() + 300_000;
    while (twoMonths && monthsSeen().length < 2 && Date.now() < deadline) {
        if (panicLine() !== null) break;
        await page.keyboard.press("Escape");
        dismissed += 1;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    twoMonths = twoMonths && monthsSeen().length >= 2;
    const started = consoleMessages.some((m) => m.includes("osiris web: city ") && m.includes(" started"));
    console.log("osiris web: pressed Escape " + dismissed + " times to close the mission's screens");

    for (const message of consoleMessages) console.log(message);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: "/tmp/osiris-web-city.png", fullPage: false });
    const shot = fs.statSync("/tmp/osiris-web-city.png").size;
    console.log("osiris web: screenshot written to /tmp/osiris-web-city.png (" + shot + " bytes)");

    const panic = panicLine();
    const months = monthsSeen();
    if (panic) {
        console.error("FATAL: wasm panic detected: " + panic);
        process.exitCode = 1;
    } else if (!started) {
        console.error("FAIL: never saw the city start from the menu");
        process.exitCode = 1;
    } else if (!twoMonths || months.length < 2) {
        console.error("FAIL: the city did not run two months (saw " + JSON.stringify(months) + ")");
        process.exitCode = 1;
    } else if (shot < 50_000) {
        console.error("FAIL: the city screenshot is only " + shot + " bytes, likely blank");
        process.exitCode = 1;
    } else {
        console.log("osiris web: the menu started a city that ran " + months.length + " months: " + months.join(", "));
    }
}

/**
 * The soak run's own lines: `soak month <n> memory <bytes>` once a month, and the fps the
 * app logs every ten seconds. `from` is a `consoleMessages` index, so a second city does
 * not count the first one's months.
 */
function soakMonths(from = 0) {
    const months = [];
    for (const message of consoleMessages.slice(from)) {
        const hit = message.match(/osiris web: soak month (\d+) memory (\d+)/);
        if (hit) months.push({ month: Number(hit[1]), bytes: Number(hit[2]) });
    }
    return months;
}

function soakFps(from = 0) {
    const rates = [];
    for (const message of consoleMessages.slice(from)) {
        const hit = message.match(/osiris web: fps (\d+)/);
        if (hit) rates.push(Number(hit[1]));
    }
    return rates;
}

/**
 * The soak run's frame split, logged next to each fps line (web-perf):
 * `osiris web: frame ms sim 1.2 render 130.4 io 0.3 other 35.1 (worst sim 9.0 render 210.0
 * io 4.0)`. `render` is the CPU time of building and submitting the frame; the browser draws
 * after that, and what it spends is `other`.
 */
function soakSplits(from = 0) {
    const splits = [];
    const line = /osiris web: frame ms sim ([\d.]+) render ([\d.]+) io ([\d.]+) other (-?[\d.]+) \(worst sim ([\d.]+) render ([\d.]+) io ([\d.]+)\)/;
    for (const message of consoleMessages.slice(from)) {
        const hit = message.match(line);
        if (hit) {
            splits.push({
                sim: Number(hit[1]),
                render: Number(hit[2]),
                io: Number(hit[3]),
                other: Number(hit[4]),
                worstSim: Number(hit[5]),
                worstRender: Number(hit[6]),
                worstIo: Number(hit[7]),
            });
        }
    }
    return splits;
}

/**
 * One frame split for the whole run: the mean of the windows' averages, and the worst frame
 * of every window. The line reads the same as the app's own, so the two can be compared.
 */
function soakSplitSummary(splits) {
    const mean = (pick) => splits.reduce((sum, split) => sum + pick(split), 0) / splits.length;
    const worst = (pick) => Math.max(...splits.map(pick));
    return (
        "frame ms sim " + mean((s) => s.sim).toFixed(1) +
        " render " + mean((s) => s.render).toFixed(1) +
        " io " + mean((s) => s.io).toFixed(1) +
        " other " + mean((s) => s.other).toFixed(1) +
        " (worst sim " + worst((s) => s.worstSim).toFixed(1) +
        " render " + worst((s) => s.worstRender).toFixed(1) +
        " io " + worst((s) => s.worstIo).toFixed(1) + ")"
    );
}

/** The ladder of speeds `]` walks in `game.rs`: eleven presses from the city's 70% reach it. */
const SPEED_STEPS = 11;

/**
 * The confirm popup's OK button on the 1280x768 canvas: `popup.rs` puts the panel 80 in
 * from the corner of the centred 640x480 window and OK 256 right and 100 down of it, a
 * 34 pixel button. The canvas is 1280x768 at a device pixel ratio of 1, so these are page
 * pixels too.
 */
const POPUP_OK = [656 + 17, 324 + 17];

/**
 * What the game says is holding the city, as `debug_city()` returns it (web-soak): the idle
 * flag, and the messages and panels that keep Escape from asking "Leave the Kingdom?".
 */
async function cityState() {
    return page.evaluate(() => (globalThis.debug_city ? globalThis.debug_city() : "no debug_city"));
}

/** Whether the game is showing the confirm popup, from `debug_city()`'s JSON. */
async function confirmOpen() {
    const state = await cityState();
    try {
        return JSON.parse(state).confirm === true;
    } catch {
        return false;
    }
}

/**
 * Leaves the city the way a player does: Escape asks "Leave the Kingdom?" and the popup's OK
 * is a click. `popup.rs` puts the panel 80 in from the corner of the centred 640x480 window
 * and OK 256 right and 100 down of the panel's corner, and `extra` (the height of the text it
 * asked about) moves it down, so the sweep walks the OK's column: the panel is centred, so
 * `x` is always the canvas centre plus 33. A click that misses lands on the map and opens
 * something, which the next Escape closes.
 */
async function leaveCity() {
    const origin = await canvasOrigin();
    for (let y = 341; y <= 421; y += 10) {
        if (!(await confirmOpen())) {
            await page.keyboard.press("Escape");
            await new Promise((resolve) => setTimeout(resolve, 700));
            if (!(await confirmOpen())) continue;
        }
        const from = consoleMessages.length;
        await clickGame(POPUP_OK[0], y);
        const back = await until(
            () => consoleMessages.slice(from).some((m) => m.includes("osiris web: page main") || m.includes("osiris web: page family")),
            1_000,
            200
        );
        if (back) {
            console.log("osiris web: left the city and the menu is back (OK at y " + y + ")");
            return true;
        }
    }
    console.error("FAIL: the city never went back to a menu page, state " + (await cityState()));
    process.exitCode = 1;
    return false;
}

/**
 * On Custom Missions or the editor's list: scrolls down until the row `name` is drawn,
 * then clicks it. The list shows fifteen of the game's maps at a time, so a map past the
 * fold needs the arrows (they are in `debug_menu_buttons()` as `Scroll(1)`).
 */
async function clickMap(name) {
    let sawScroll = false;
    let lastLabels = [];
    for (let tries = 0; tries < 30; tries += 1) {
        const buttons = await menuButtons();
        lastLabels = buttons.map((b) => b.label);
        const hit = buttons.find((b) => b.label === name && b.action.startsWith("Choose("));
        if (hit) {
            const origin = await canvasOrigin();
            await page.mouse.click(origin.left + hit.x + hit.w / 2, origin.top + hit.y + hit.h / 2);
            console.log("osiris web: clicked " + hit.action + " (" + hit.label + ")");
            return true;
        }
        // The buttons are recorded as the page draws, so the page that has just opened may
        // still report the one before it: wait for the list's own arrow instead of giving up.
        if (buttons.some((b) => b.action === "Scroll(1)")) {
            sawScroll = true;
            await clickMenu("Scroll(1)");
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    console.error(
        "FAIL: no row named " + JSON.stringify(name) + " on the list" +
        (sawScroll ? "" : "; the list never showed its scroll arrows") +
        "; the page had " + JSON.stringify(lastLabels.slice(0, 20))
    );
    process.exitCode = 1;
    return false;
}

/**
 * Waits for the soak run's months, pressing Escape so a message that opens does not stop
 * the clock. Fails on a panic, on a month that takes more than the 60 s of the issue, and
 * on the app's line that the memory grew every month for twelve months in a row.
 */
async function soakWait(wanted, from, label) {
    let monthStart = Date.now();
    let seen = 0;
    let escapes = 0;
    for (;;) {
        const panic = panicLine();
        if (panic) {
            console.error("FATAL: wasm panic detected: " + panic);
            process.exitCode = 1;
            return false;
        }
        if (consoleMessages.slice(from).some((m) => m.includes("osiris web: soak memory grew every month"))) {
            console.error("FAIL: " + label + " memory grew every month for twelve months in a row");
            process.exitCode = 1;
            return false;
        }
        const months = soakMonths(from).length;
        if (months >= wanted) {
            console.log("osiris web: " + label + " reached " + months + " months (" + escapes + " Escapes)");
            return true;
        }
        if (months !== seen) {
            seen = months;
            monthStart = Date.now();
        } else if (Date.now() - monthStart > 60_000) {
            console.error("FAIL: " + label + " month " + (seen + 1) + " did not arrive within 60 s");
            process.exitCode = 1;
            return false;
        }
        await page.keyboard.press("Escape");
        escapes += 1;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
}

/** The soak run's numbers for one city, as the line the issue asks for. */
function soakSummary(months, rates, label) {
    if (months.length === 0) {
        console.error("FAIL: " + label + " logged no month at all");
        process.exitCode = 1;
        return null;
    }
    if (rates.length === 0) {
        console.error("FAIL: " + label + " logged no fps line");
        process.exitCode = 1;
        return null;
    }
    const start = Math.round(months[0].bytes / (1024 * 1024));
    const end = Math.round(months[months.length - 1].bytes / (1024 * 1024));
    return { months: months.length, minFps: Math.min(...rates), start, end };
}

/**
 * The trace categories of the DevTools Performance panel, with the V8 CPU profiler on, so the
 * trace holds main-thread slices and JS samples (web-frame-trace design 2).
 */
const TRACE_CATEGORIES = [
    "-*",
    "devtools.timeline",
    "v8.execute",
    "disabled-by-default-devtools.timeline",
    "disabled-by-default-devtools.timeline.frame",
    "toplevel",
    "blink.console",
    "blink.user_timing",
    "latencyInfo",
    "disabled-by-default-devtools.timeline.stack",
    "disabled-by-default-v8.cpu_profiler",
    "disabled-by-default-v8.cpu_profiler.hires",
].join(",");

/** How many seconds of the running city the trace records. */
const TRACE_SECONDS = 20;

/** The city's own state as `debug_city()` reports it, parsed, or null when it is not there. */
async function cityStateJson() {
    try {
        return JSON.parse(await cityState());
    } catch {
        return null;
    }
}

/**
 * Closes the mission's opening screens with Escape until the city is idle and running: the
 * briefing reviewed covers the city when it starts, and a message stops the clock. The soak
 * run dismisses the same screens, so the trace describes the same run.
 */
async function settleCity(maxTries = 12) {
    for (let tries = 0; tries < maxTries; tries += 1) {
        const state = await cityStateJson();
        if (state && state.idle && !state.paused) return { ok: true, escapes: tries };
        await page.keyboard.press("Escape");
        await new Promise((resolve) => setTimeout(resolve, 700));
    }
    const state = await cityStateJson();
    return { ok: Boolean(state && state.idle && !state.paused), escapes: maxTries };
}

/**
 * SMOKE_TRACE=<file>: the soak run's setup (the menu walk to the first mission, the fastest
 * speed, the app's own fps and frame lines) and then 20 s of the running city recorded as a
 * Chrome performance trace, written to `<file>` (web-frame-trace design 2). The only work
 * during the recording is Escape when a message has opened a screen, as the soak run does;
 * nothing polls or evaluates in the page, so the harness cannot be what fills a gap.
 */
async function runTrace() {
    if (!(await enterFirstMission("Trace"))) return;
    // The click that starts the city is the last thing `enterFirstMission` does, and the app's
    // line comes with it, so wait for the whole log: the line can already be there before the
    // speed ladder below.
    const started = await until(
        () => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: city ") && m.includes(" started")),
        120_000,
        500
    );
    if (!started) {
        console.error("FAIL: the trace run never started the city");
        process.exitCode = 1;
        return;
    }
    const settled = await settleCity();
    if (!settled.ok) {
        console.error("FAIL: the city never became idle for the trace, state " + (await cityState()));
        process.exitCode = 1;
        return;
    }
    console.log("osiris web: the city is running (" + settled.escapes + " Escapes to close its screens)");
    // The app's own lines make the run comparable with the soak: min fps and the frame split.
    await page.evaluate(() => set_soak(true));
    const origin = await canvasOrigin();
    await page.mouse.click(origin.left + 640, origin.top + 384);
    for (let i = 0; i < SPEED_STEPS; i += 1) await page.keyboard.press("BracketRight");
    // A moment for the first frames at the new speed to pass, so the trace is the steady state.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    // The frame lines this run produces after the trace starts.
    const from = consoleMessages.length;

    // The browser-level session is the one the Tracing domain lives on, and its events are the
    // DevTools Performance panel's own (design 2).
    const cdp = await browser.newBrowserCDPSession();
    const events = [];
    cdp.on("Tracing.dataCollected", ({ value }) => {
        if (Array.isArray(value)) events.push(...value);
    });
    const complete = new Promise((resolve) => cdp.on("Tracing.tracingComplete", resolve));
    await cdp.send("Tracing.start", { categories: TRACE_CATEGORIES, transferMode: "ReportEvents" });
    console.log("osiris web: trace run started at the fastest game speed, recording " + TRACE_SECONDS + " s");
    let escapes = 0;
    for (let step = 0; step < TRACE_SECONDS / 2; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        // A month's message stops the city; the soak run closes it the same way, and the
        // state read is one small task, not a frame's worth of work.
        const state = await cityStateJson();
        if (state && !state.idle) {
            await page.keyboard.press("Escape");
            escapes += 1;
        }
    }
    await cdp.send("Tracing.end");
    await complete;

    if (events.length === 0) {
        console.error("FAIL: the trace recorded no event");
        process.exitCode = 1;
        return;
    }
    fs.mkdirSync(path.dirname(path.resolve(TRACE_FILE)), { recursive: true });
    fs.writeFileSync(TRACE_FILE, JSON.stringify(events));
    const bytes = fs.statSync(TRACE_FILE).size;

    // The fps and frame lines the same run produced, so the trace and the timers describe one run.
    await until(() => soakFps(from).length > 0, 25_000, 500);
    await until(() => soakSplits(from).length > 0, 25_000, 500);
    const rates = soakFps(from);
    const splits = soakSplits(from);
    if (rates.length > 0) {
        console.log("osiris web: trace run min fps " + Math.min(...rates) + " over " + rates.length + " window(s)");
    }
    if (splits.length > 0) console.log("osiris web: " + soakSplitSummary(splits));

    const panic = panicLine();
    if (panic) {
        console.error("FATAL: wasm panic detected: " + panic);
        process.exitCode = 1;
        return;
    }
    console.log(
        "osiris web: trace written to " + TRACE_FILE + " (" + events.length + " events, " +
        Math.round(bytes / (1024 * 1024)) + " MB, " + escapes + " Escapes)"
    );
    console.log("osiris web: trace OK (" + TRACE_SECONDS + " s of the city, " + events.length + " events)");
}

/**
 * SMOKE_SOAK=1: mission 0 from the menu at the fastest speed for 24 months, then the
 * custom map and the editor runs (`design.md` 6 to 8).
 */
async function runSoakMission() {
    if (!(await enterFirstMission("Soak"))) return;
    // The city has to be running before the month lines have anything to say.
    await page.evaluate(() => set_soak(true));
    // A click gives the canvas the keyboard; the ladder's top is eleven `]` presses.
    const origin = await canvasOrigin();
    await page.mouse.click(origin.left + 640, origin.top + 384);
    for (let i = 0; i < SPEED_STEPS; i += 1) await page.keyboard.press("BracketRight");
    const from = consoleMessages.length;
    console.log("osiris web: soak run started at the fastest game speed");

    if (!(await soakWait(24, from, "the mission run"))) return;
    // The FPS line comes every ten seconds of real time, and at the fastest speed the months
    // can pass quicker than that: wait for one before reading the numbers.
    await until(() => soakFps(from).length > 0, 25_000, 500);
    // The frame split comes with each of those lines (web-perf). The run stops at 24 months,
    // so a line can be one window short of the last month; the numbers are the same either way.
    await until(() => soakSplits(from).length > 0, 25_000, 500);
    // The app's own lines: a month and its memory, and the fps every ten seconds.
    for (const message of consoleMessages.slice(from)) console.log(message);
    // A month can turn while the test is pressing Escape, so the run stops at 24.
    const months = soakMonths(from).slice(0, 24);
    const rates = soakFps(from);
    const numbers = soakSummary(months, rates, "the mission run");
    if (!numbers) return;
    // Where the frame time went over the whole run, and the files the game read the slowest,
    // so the soak line names the biggest cost (web-perf).
    const splits = soakSplits(from);
    if (splits.length === 0) {
        console.error("FAIL: the mission run logged no frame split line");
        process.exitCode = 1;
        return;
    }
    console.log("osiris web: " + soakSplitSummary(splits));
    const top = await page.evaluate(() => debug_top_reads());
    console.log("osiris web: top reads " + (top === "" ? "(no file read)" : top));
    console.log(
        "osiris web: soak OK (" + numbers.months + " months, min fps " + numbers.minFps +
        ", memory start " + numbers.start + " MB end " + numbers.end + " MB)"
    );

    // ── Second run: a custom map from `Maps/` (design 7) ────────────────────
    if (!(await leaveCity())) return;
    if (!(await clickMenuTo("Go(Custom)", "custom"))) {
        console.error("FAIL: the custom missions page never came up");
        process.exitCode = 1;
        return;
    }
    if (!(await clickMap("Small Oasis"))) return;
    const customFrom = consoleMessages.length;
    await clickMenu("Choose(StartMap)");
    const started = await until(
        () => panicLine() !== null || consoleMessages.slice(customFrom).some((m) => m.includes("osiris web: city ") && m.includes(" started")),
        120_000,
        500
    );
    if (!started) {
        console.error("FAIL: the custom map never started a city");
        process.exitCode = 1;
        return;
    }
    // A city starts at 70% again, so the ladder's top is the same eleven presses.
    const customOrigin = await canvasOrigin();
    await page.mouse.click(customOrigin.left + 640, customOrigin.top + 384);
    for (let i = 0; i < SPEED_STEPS; i += 1) await page.keyboard.press("BracketRight");
    console.log("osiris web: custom map run started at the fastest game speed");

    if (!(await soakWait(6, customFrom, "the custom map run"))) return;
    // The FPS line comes every ten seconds of real time, and six months at the fastest speed
    // can be quicker than that: wait for one before reading the numbers.
    await until(() => soakFps(customFrom).length > 0, 25_000, 500);
    for (const message of consoleMessages.slice(customFrom)) console.log(message);
    const customMonths = soakMonths(customFrom).slice(0, 6);
    const customRates = soakFps(customFrom);
    const mapNumbers = soakSummary(customMonths, customRates, "the custom map run");
    if (!mapNumbers) return;
    console.log(
        "osiris web: custom map soak OK (" + mapNumbers.months + " months on Small Oasis, min fps " +
        mapNumbers.minFps + ", memory start " + mapNumbers.start + " MB end " + mapNumbers.end + " MB)"
    );

    // ── Third run: the Mission Editor (design 8) ───────────────────────────
    if (!(await leaveCity())) return;
    if (!(await clickMenuTo("Go(Editor)", "editor"))) {
        console.error("FAIL: the Mission Editor page never came up");
        process.exitCode = 1;
        return;
    }
    if (!(await clickMap("Small Oasis"))) return;
    const editorFrom = consoleMessages.length;
    await clickMenu("Choose(StartEdit)");
    const opened = await until(
        () => panicLine() !== null || consoleMessages.slice(editorFrom).some((m) => m.includes("osiris web: editor open ")),
        120_000,
        500
    );
    if (!opened) {
        console.error("FAIL: the Mission Editor never opened Small Oasis");
        process.exitCode = 1;
        return;
    }
    if (!(await runEditorPaint())) return;
    if (!(await runEditorSave())) return;
    if (!(await runEditorExit())) return;
    console.log("osiris web: editor OK (Small Oasis edited and saved as " + EDITED_PATH + ")");
}

/** The editor's own state, as `debug_editor()` returns it. */
async function editorState() {
    const state = await page.evaluate(() => (globalThis.debug_editor ? globalThis.debug_editor() : ""));
    try {
        return JSON.parse(state);
    } catch {
        return { name: null, dirty: null, path: null, status: null, tool: null, raw: state };
    }
}

/**
 * Picks the grass tool from the editor's palette and paints three tiles. `view.rs` lays the
 * buttons out relative to the 186 pixel panel on the right (`WIDTH`) and `TOP` (24): the
 * grass button is 13 in and 267 down, 39 by 26. A paint lands on the map only while a tool
 * is held, and `debug_editor()`'s `dirty` and `tool` say whether it took.
 */
async function runEditorPaint() {
    const size = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        return c ? [c.width, c.height] : [1280, 768];
    });
    await clickGame(size[0] - 186 + 32, 24 + 280);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const picked = await editorState();
    if (picked.tool !== "paint") {
        console.error("FAIL: the grass button did not pick a tool, editor state " + JSON.stringify(picked));
        process.exitCode = 1;
        return false;
    }
    for (const [x, y] of [[600, 400], [640, 420], [680, 400]]) {
        await clickGame(x, y);
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const painted = await editorState();
    if (painted.dirty !== true) {
        console.error("FAIL: painting three tiles left the map clean, editor state " + JSON.stringify(painted));
        process.exitCode = 1;
        return false;
    }
    console.log("osiris web: painted three tiles with the grass tool");
    return true;
}

/** Whether the editor's status line says it saved the map. */
async function editorSaved() {
    const state = await editorState();
    return typeof state.status === "string" && state.status.startsWith("Saved ");
}

/** Set by `runEditorSave()`: the path the test saved the edited map under. */
let EDITED_PATH = "";

/**
 * File > Save, which asks for a name (`Popup::SaveName`) because the map came from the game's
 * own `Maps/` and cannot be written back. The name box starts with the map's name, so the test
 * erases it and types its own; Enter saves into `/user/maps`. The menu bar is the game's own
 * (`top_menu.rs`): headers below y 30, the drop-down at 42 with 20 pixel entries, Save third.
 */
async function runEditorSave() {
    await clickGame(20, 15);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await clickGame(60, 42 + 2 * 20 + 10);
    await new Promise((resolve) => setTimeout(resolve, 800));
    // A map can be missing an entry or exit point, and File > Save then asks "Save anyway?"
    // first; its OK is the confirm popup's (popup.rs), so walk the OK's column like the city
    // run does. `debug_editor()`'s `popup` says when the name box is up.
    let state = await editorState();
    for (let y = 341; y <= 421 && state.popup !== "save-name"; y += 10) {
        await clickGame(673, y);
        await new Promise((resolve) => setTimeout(resolve, 400));
        state = await editorState();
    }
    if (state.popup !== "save-name") {
        console.error("FAIL: File > Save did not ask for a name, editor state " + JSON.stringify(state));
        process.exitCode = 1;
        return false;
    }
    for (let i = 0; i < 12; i += 1) await page.keyboard.press("Backspace");
    await page.keyboard.type("Soak Edit", { delay: 60 });
    await page.keyboard.press("Enter");
    await new Promise((resolve) => setTimeout(resolve, 800));
    // The name box's OK button sits 256 in and 100 down from the popup's corner
    // (`click_popup` in view.rs), which is the same OK the city popups use.
    if (!(await editorSaved())) {
        await clickGame(673, 341);
        await new Promise((resolve) => setTimeout(resolve, 800));
    }
    const saved = await until(async () => {
        const now = await editorState();
        return typeof now.status === "string" && now.status.startsWith("Saved ");
    }, 20_000, 500);
    state = await editorState();
    if (!saved || typeof state.path !== "string" || !state.path.startsWith("/user/maps/")) {
        console.error("FAIL: the editor did not save the map under a new name, editor state " + JSON.stringify(state));
        process.exitCode = 1;
        return false;
    }
    EDITED_PATH = state.path;
    console.log("osiris web: saved the edited map as " + EDITED_PATH);
    return true;
}

/** File > Exit, which asks nothing while the map is saved, and the menu comes back. */
async function runEditorExit() {
    const from = consoleMessages.length;
    await clickGame(20, 15);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await clickGame(60, 42 + 4 * 20 + 10);
    const back = await until(
        () => consoleMessages.slice(from).some((m) => m.includes("osiris web: page main") || m.includes("osiris web: page family")),
        20_000,
        250
    );
    if (!back) {
        console.error("FAIL: the editor never went back to the menu, editor state " + JSON.stringify(await editorState()));
        process.exitCode = 1;
        return false;
    }
    if ((await panicLine()) !== null) {
        console.error("FAIL: the page panicked in the editor run");
        process.exitCode = 1;
        return false;
    }
    console.log("osiris web: left the editor and the menu is back");
    return true;
}

// The city's menu bar (`top_menu.rs`): `TopMenu::layout` starts the headers at x=10 and the
// bar is `sidebar::TOP` (30) pixels tall, so File sits at the very left. Its drop-down starts
// at y=42 and each entry is 20 pixels tall, in `TopMenu::new`'s order: New game, Replay
// mission, Load game, Save game. These are the game's own screen pixels; the smoke's canvas
// is 1280x768 at a device pixel ratio of 1, so they are page pixels too.
const FILE_HEADER = [20, 15];
const FILE_LOAD = [60, 92];

/** Click the canvas at game screen pixel `x`, `y`, the way the player's click arrives. */
async function clickGame(x, y) {
    const origin = await canvasOrigin();
    await page.mouse.click(origin.left + x, origin.top + y);
}

/**
 * SMOKE_SAVES=1: a saved game leaves the browser and comes back. The menu mission's city is
 * running; F5 is the game's own quick save (winit's canvas keeps the browser's own F5 reload
 * off while it has the keyboard). The panel's Download goes to Playwright's download folder
 * and the file is compared with browser storage; the save is then deleted, imported again
 * from that file, and loaded from the game's own Load Saved Game screen, which File > Load
 * game opens. Prints `osiris web: saves export/import OK` when every step held.
 */
async function runSaves() {
    const problems = [];
    const fail = (message) => {
        console.error("FAIL: " + message);
        process.exitCode = 1;
        problems.push(message);
    };
    const rowFor = (savePath) => '[data-path="' + savePath + '"]';
    const listed = (savePath) =>
        page.evaluate((p) => !!document.querySelector('[data-path="' + p + '"]'), savePath);
    // The save's own bytes as browser storage holds them: -1 when it holds no such file. The
    // game's writes reach IndexedDB through a hook, so flush them first (`osirisStore.idle`).
    const storedSize = (savePath) =>
        page.evaluate(async (p) => {
            await globalThis.osirisStore.idle();
            const pairs = await globalThis.osirisStore.loadAll();
            const hit = pairs.find(([key]) => key === p);
            return hit ? hit[1].length : -1;
        }, savePath);
    // The panel asks before it deletes a save, as it should; the smoke says yes.
    page.on("dialog", (dialog) => dialog.accept());

    // The menu mode starts the game through the wasm export, so the page's own `start()` never
    // ran and the start screen is still over the city with the controls hidden. Give the page
    // the state `start()` gives it, which is what the player sees, so the Saves button is there.
    await page.evaluate(() => {
        document.getElementById("start").hidden = true;
        document.getElementById("start").style.display = "none";
        document.getElementById("osiris").hidden = false;
        document.getElementById("controls").hidden = false;
    });

    // 1. F5 saves the city, and `quicksave` logs the path and the size it wrote.
    let from = consoleMessages.length;
    await page.keyboard.press("F5");
    await until(() => consoleMessages.slice(from).some((m) => m.includes("osiris web: saved ")), 30_000);
    const savedLine = consoleMessages.slice(from).find((m) => m.includes("osiris web: saved "));
    const saved = /osiris web: saved (.+) \((\d+) bytes\)/.exec(savedLine ?? "");
    if (!saved) {
        fail("F5 did not save the city (no 'osiris web: saved <path> (<n> bytes)')");
        for (const m of consoleMessages.slice(from)) console.log(m);
        return;
    }
    const savePath = saved[1];
    const bytes = Number(saved[2]);
    console.log("osiris web: F5 saved " + savePath + " (" + bytes + " bytes)");

    // 2. The panel lists it: the family's name, the file's name, its size and its time.
    await page.click("#saves-button");
    await page.waitForSelector(rowFor(savePath), { timeout: 20_000 }).catch(() => {});
    const row = await page.evaluate((p) => {
        const tr = document.querySelector('[data-path="' + p + '"]');
        return tr ? Array.from(tr.querySelectorAll("td")).map((td) => td.textContent) : null;
    }, savePath);
    if (!row) {
        fail("the Saves panel never listed " + savePath);
        return;
    }
    console.log("osiris web: the panel's row reads " + JSON.stringify(row));
    if (row[0] !== "Smoke") fail("the row's family cell is " + JSON.stringify(row[0]) + ", not Smoke");
    if (row[1] !== path.posix.basename(savePath)) fail("the row's file cell is " + JSON.stringify(row[1]));
    if (row[2].trim() === "") fail("the row has no size");
    if (!/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(row[3])) fail("the row has no date (" + JSON.stringify(row[3]) + ")");

    // 3. Download it: the Blob and the `<a download>` link, straight into a folder on disk.
    const downloadDir = "/tmp/osiris-saves";
    fs.rmSync(downloadDir, { recursive: true, force: true });
    fs.mkdirSync(downloadDir, { recursive: true });
    let file = null;
    try {
        const waiting = page.waitForEvent("download", { timeout: 30_000 });
        await page.click(rowFor(savePath) + " .save-download");
        const download = await waiting;
        file = path.join(downloadDir, download.suggestedFilename());
        await download.saveAs(file);
    } catch (err) {
        fail("the panel's Download produced no file: " + err.message);
        return;
    }

    // 4. The file, the game's own line and browser storage all agree on the size.
    const inStore = await storedSize(savePath);
    const fileSize = fs.statSync(file).size;
    console.log(
        "osiris web: " + path.basename(file) + " is " + fileSize + " bytes, the game wrote " + bytes +
        ", browser storage holds " + inStore
    );
    if (path.basename(file) !== path.posix.basename(savePath)) fail("the download is named " + path.basename(file));
    if (fileSize !== bytes) fail("the download is " + fileSize + " bytes, not the save's " + bytes);
    if (inStore !== bytes) fail("browser storage holds " + inStore + " bytes, not " + bytes);

    // 5. Delete it from the panel, and from browser storage with it.
    await page.click(rowFor(savePath) + " .save-delete");
    await page
        .waitForFunction((p) => !document.querySelector('[data-path="' + p + '"]'), savePath, { timeout: 30_000 })
        .catch(() => {});
    const afterDelete = await storedSize(savePath);
    const stillListed = await listed(savePath);
    console.log("osiris web: after the delete the panel lists it: " + stillListed + ", storage holds " + afterDelete + " bytes");
    if (stillListed) fail("the deleted save is still in the panel");
    if (afterDelete !== -1) fail("the deleted save is still in browser storage (" + afterDelete + " bytes)");

    // 6. Import the downloaded file again: the panel writes it through the game's own path.
    await page.setInputFiles("#import", file);
    await page
        .waitForFunction((p) => !!document.querySelector('[data-path="' + p + '"]'), savePath, { timeout: 60_000 })
        .catch(() => {});
    const afterImport = await storedSize(savePath);
    const status = await page.evaluate(() => document.getElementById("saves-status")?.textContent ?? "");
    console.log("osiris web: after the import the panel says " + JSON.stringify(status) + ", storage holds " + afterImport + " bytes");
    if (!(await listed(savePath))) fail("the imported save is not in the panel");
    if (afterImport !== bytes) fail("the imported save is " + afterImport + " bytes, not " + bytes);

    // 7. Load it from the game's own Load Saved Game screen: File > Load game.
    await page.click("#saves-close");
    from = consoleMessages.length;
    await clickGame(FILE_HEADER[0], FILE_HEADER[1]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await clickGame(FILE_LOAD[0], FILE_LOAD[1]);
    if (!(await waitPage("load", 30_000, from))) {
        fail("File > Load game did not open the saved games page");
        for (const m of consoleMessages.slice(from)) console.log(m);
        return;
    }
    // A row picks the save and the picked row again loads it (`Menu::click_load`).
    await clickMenu("Choose(Save");
    await clickMenu("Choose(Save");
    const loaded = await until(
        () => consoleMessages.slice(from).some((m) => m.includes("osiris web: city 0 started")),
        180_000,
        500
    );
    if (!loaded) {
        fail("the loaded save never started its city");
        for (const m of consoleMessages.slice(from)) console.log(m);
        return;
    }
    console.log("osiris web: the Load Saved Game screen loaded the imported save");

    if (problems.length === 0) console.log("osiris web: saves export/import OK");
}

/** The PNG's width and height, read from the file's own header. */
function pngSize(file) {
    const head = fs.readFileSync(file).subarray(0, 24);
    const signature = head.subarray(0, 8).toString("latin1");
    if (signature !== "\x89PNG\r\n\x1a\n") return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/**
 * SMOKE_VIEWPORT=WxH[,W2xH2...]: the fit, end to end. The page started the game from its own
 * picker, so `main.js` sized the canvas; the game has to have resized its surface to it, the
 * city has to fill the frame with no black bar left over, and a smaller window has to be filled.
 * Checks scroll bars and interface scale logging for each viewport size.
 */
async function runViewportChecks() {
    const ratio = await page.evaluate(() => window.devicePixelRatio || 1);
    /** @type {{ vp: string, problems: string[] }[]} */
    const results = [];

    for (const vp of VIEWPORT) {
        const startPixels = { width: Math.floor(vp.width * ratio), height: Math.floor(vp.height * ratio) };
        const startLine = "osiris web: set canvas to " + vp.width + "x" + vp.height;

        /** @type {string[]} */
        const problems = [];

        // ── Scroll bar check (no scroll bars at the initial viewport size) ──
        const scrollBars = await page.evaluate(() => ({
            hScroll: document.documentElement.scrollWidth > window.innerWidth,
            vScroll: document.documentElement.scrollHeight > window.innerHeight,
        }));
        if (scrollBars.hScroll || scrollBars.vScroll) {
            problems.push("scroll bars visible (h " + scrollBars.hScroll + "/ v " + scrollBars.vScroll + ")");
        }

        // ── Interface scale logging detection (wasm logs the capped scale) ──
        const hasScaleLog = consoleMessages.some((m) => m.includes("osiris web: interface scale"));
        if (!hasScaleLog && (vp.width < 1024 || vp.height < 768)) {
            problems.push("no 'osiris web: interface scale' log line for " + vp.width + "x" + vp.height);
        }

    if (!consoleMessages.some((m) => m.includes(startLine))) {
        problems.push("the page never printed " + startLine);
    } else {
        console.log("osiris web: the page printed " + startLine);
    }

    // The canvas is the window: same CSS size, at the window's origin, nothing around it.
    const fit = await page.evaluate(() => {
        const canvas = document.getElementById("osiris");
        const rect = canvas.getBoundingClientRect();
        return {
            inner: [window.innerWidth, window.innerHeight],
            bitmap: [canvas.width, canvas.height],
            css: [canvas.style.width, canvas.style.height],
            rect: [rect.left, rect.top, rect.width, rect.height],
            controls: !document.getElementById("controls").hidden,
            startHidden: document.getElementById("start").hidden,
        };
    });
    if (fit.inner[0] !== vp.width || fit.inner[1] !== vp.height) {
        problems.push("the window is " + fit.inner.join("x") + ", not " + VIEWPORT_RAW);
    }
    if (fit.bitmap[0] !== startPixels.width || fit.bitmap[1] !== startPixels.height) {
        problems.push("the canvas bitmap is " + fit.bitmap.join("x") + ", want " + startPixels.width + "x" + startPixels.height);
    }
    if (fit.rect[0] !== 0 || fit.rect[1] !== 0 || fit.rect[2] !== vp.width || fit.rect[3] !== vp.height) {
        problems.push("the canvas does not fill the window (at " + fit.rect.join(",") + ")");
    }
    if (!fit.controls) problems.push("the corner controls are not on screen while the game runs");
    if (!fit.startHidden) problems.push("the start page is still on screen while the game runs");

    // The screenshot the mission run took must be the window, and no edge may be black.
    const shotFile = "/tmp/osiris-web-city.png";
    const size = fs.existsSync(shotFile) ? pngSize(shotFile) : null;
    if (!size) {
        problems.push("no readable city screenshot at " + shotFile);
    } else if (size.width !== vp.width || size.height !== vp.height) {
        problems.push("the screenshot is " + size.width + "x" + size.height + ", not " + VIEWPORT_RAW);
    } else {
        console.log("osiris web: the screenshot is " + size.width + "x" + size.height);
    }

    // Read the frame straight out of the canvas: how deep the black goes from each edge, and
    // proof that the buffer holds a picture at all (a cleared buffer would look all black).
    const border = await page.evaluate(() => {
        const canvas = document.getElementById("osiris");
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        if (!gl) return { error: "the canvas has no WebGL context" };
        const width = canvas.width;
        const height = canvas.height;
        const depth = 64;
        const strip = (x, y, w, h) => {
            const pixels = new Uint8Array(w * h * 4);
            gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return { pixels, w };
        };
        const black = (s, i) => s.pixels[i] < 8 && s.pixels[i + 1] < 8 && s.pixels[i + 2] < 8;
        const step = 16;
        const left = strip(0, 0, depth, height);
        const right = strip(width - depth, 0, depth, height);
        const bottom = strip(0, 0, width, depth);
        const top = strip(0, height - depth, width, depth);
        const into = (strip, lines, at) => lines.map((line) => {
            let d = 0;
            while (d < depth && at(strip, line, d)) d += 1;
            return d;
        });
        const ys = [];
        for (let y = 0; y < height; y += step) ys.push(y);
        const xs = [];
        for (let x = 0; x < width; x += step) xs.push(x);
        const sorted = (runs) => {
            const copy = [...runs].sort((a, b) => a - b);
            return copy[Math.floor(copy.length / 2)];
        };
        // A cleared drawing buffer would make every edge look black, so check a band of the
        // middle of the frame for a picture.
        const band = strip(0, Math.floor(height / 2) - 32, width, 64);
        let lit = 0;
        for (let i = 0; i < band.pixels.length; i += 4) {
            if (band.pixels[i] > 8 || band.pixels[i + 1] > 8 || band.pixels[i + 2] > 8) lit += 1;
        }
        return {
            width,
            height,
            left: sorted(into(left, ys, (s, y, d) => black(s, (y * s.w + d) * 4))),
            right: sorted(into(right, ys, (s, y, d) => black(s, (y * s.w + (s.w - 1 - d)) * 4))),
            bottom: sorted(into(bottom, xs, (s, x, d) => black(s, (d * s.w + x) * 4))),
            top: sorted(into(top, xs, (s, x, d) => black(s, ((s.pixels.length / 4 / s.w - 1 - d) * s.w + x) * 4))),
            lit,
        };
    });
    if (border.error) {
        problems.push(border.error);
    } else if (border.lit === 0) {
        problems.push("the canvas holds no picture (every pixel read back black)");
    } else {
        console.log(
            "osiris web: black depth from each edge: left " + border.left + ", right " + border.right +
            ", bottom " + border.bottom + ", top " + border.top + " px"
        );
        for (const [edge, value] of Object.entries({ left: border.left, right: border.right, bottom: border.bottom, top: border.top })) {
            if (value > 8) problems.push("a black border " + value + " px wide on the " + edge + " edge");
        }
    }

    // The button and F11 both ask the browser for full screen. Headless Chrome's own full
    // screen is not worth depending on, so the request is recorded instead.
    const askFullscreen = async (how) => page.evaluate((how) => {
        const canvas = document.getElementById("osiris");
        const real = canvas.requestFullscreen;
        let asked = 0;
        canvas.requestFullscreen = () => {
            asked += 1;
            return Promise.resolve();
        };
        if (how === "button") {
            document.getElementById("fullscreen").click();
        } else {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", bubbles: true }));
        }
        return new Promise((resolve) => setTimeout(() => {
            canvas.requestFullscreen = real;
            resolve(asked);
        }, 200));
    }, how);
    const byButton = await askFullscreen("button");
    if (byButton < 1) problems.push("the Fullscreen button did not ask for full screen");
    const byKey = await askFullscreen("key");
    if (byKey < 1) problems.push("F11 did not ask for full screen");

    // The corner link brings the page back over the running game, and hides it again.
    await page.click("#page");
    const backOver = await page.evaluate(() => {
        const start = document.getElementById("start");
        return {
            hidden: start.hidden,
            shown: getComputedStyle(start).display !== "none",
            over: start.classList.contains("over-game"),
        };
    });
    if (backOver.hidden || !backOver.shown || !backOver.over) {
        problems.push("the page link did not bring the start page back over the game");
    }
    await page.click("#page");
    if (!(await page.evaluate(() => document.getElementById("start").hidden))) {
        problems.push("the page link did not hide the start page again");
    }

    // A smaller window: the canvas follows it, and so does the surface.
    const small = { width: 1280, height: 720 };
    consoleMessages.length = 0;
    await page.setViewportSize(small);
    // The canvas's bitmap is its CSS size times the ratio the page sees at that moment,
    // and the ratio is read again because a resized emulated window can report another.
    const smallLine = "osiris web: set canvas to " + small.width + "x" + small.height;
    if (!(await until(() => consoleMessages.some((m) => m.includes(smallLine)), 45_000, 200))) {
        problems.push("the page never printed " + smallLine + " after the window got smaller");
    } else {
        // What the game did with it: it logs the surface size when a resize reaches it,
        // and the canvas's own size proves the page refitted either way.
        const surfaced = consoleMessages.find((m) => m.includes("osiris web: resize to"));
        if (surfaced) console.log("osiris web: the game printed " + surfaced.trim());
        const after = await page.evaluate(() => {
            const canvas = document.getElementById("osiris");
            const rect = canvas.getBoundingClientRect();
            return {
                bitmap: [canvas.width, canvas.height],
                rect: [rect.width, rect.height],
                css: [parseFloat(canvas.style.width), parseFloat(canvas.style.height)],
            };
        });
        // The bitmap is the CSS size times the device pixel ratio. Which ratio the emulated
        // window reports while it is being resized is the browser's business, so this only
        // checks that the bitmap is the CSS size at a whole ratio.
        const byX = after.bitmap[0] / after.css[0];
        const byY = after.bitmap[1] / after.css[1];
        if (after.css[0] !== small.width || after.css[1] !== small.height) {
            problems.push("the canvas is styled " + after.css.join("x") + ", want " + small.width + "x" + small.height);
        } else if (byX !== byY || !Number.isInteger(byX) || byX < 1 || byX > 4) {
            problems.push("the canvas bitmap is " + after.bitmap.join("x") + " for a " + after.css.join("x") + " canvas");
        }
        if (after.rect[0] !== small.width || after.rect[1] !== small.height) {
            problems.push("the canvas does not fill the smaller window (it is " + after.rect.join("x") + ")");
        } else {
            console.log("osiris web: the smaller window printed " + smallLine);
        }
    }

        results.push({ vp: vp.width + "x" + vp.height, problems });
    }

    // Print per-viewport summary and check for small-window issues.
    const allSmallOK = results.every((r) => {
        if (r.problems.length > 0) return false;
        // A viewport is "small" if either dimension is below the desktop minimum.
        const vpSize = VIEWPORT.find((v) => v.width === Number(r.vp.split("x")[0]) && v.height === Number(r.vp.split("x")[1]));
        return !vpSize || vpSize.width >= 1024 && vpSize.height >= 768;
    });

    for (const r of results) {
        if (r.problems.length > 0) {
            for (const problem of r.problems) console.error("FAIL [" + r.vp + "]: " + problem);
            process.exitCode = 1;
        } else {
            console.log("osiris web: viewport OK (" + r.vp + " then 1280x720)");
        }
    }

    // Small-window summary.
    const smallVPs = VIEWPORT.filter((v) => v.width < 1024 || v.height < 768);
    if (smallVPs.length > 0 && allSmallOK) {
        const scales = smallVPs.map((v) => {
            // Find the scale from console messages.
            const match = consoleMessages.find((m) => m.includes("osiris web: interface scale"))?.match(/interface scale ([\d.]+)/);
            return (match ? "scale " + match[1] : "scale ?");
        });
        console.log(
            "osiris web: small window OK ("
            + smallVPs.map((v) => v.width + "x" + v.height).join(", ")
            + ", " + scales.join(", ") + ")"
        );
    }

    if (results.some((r) => r.problems.length > 0)) {
        console.error("osiris web: viewport FAILED (" + VIEWPORT_RAW + ")");
    }
}

/**
 * SMOKE_MOVIE=intro: the original's intro plays in the browser. The browser decodes the
 * movie's frames on the main thread a few at a time, so `frame 60` proves the decoder runs
 * and that the pictures follow the sound's clock. Escape then skips to the menu, as a
 * player would.
 */
async function runIntroMovie() {
    const started = await until(
        () => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: movie Intro_big started")),
        90_000,
        100
    );
    if (!started) {
        console.error("FAIL: never saw 'osiris web: movie Intro_big started'");
        for (const m of consoleMessages) console.log(m);
        process.exitCode = 1;
        return;
    }
    const startedAt = Date.now();

    const frame60 = await until(
        () => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: movie Intro_big frame 60")),
        90_000,
        100
    );
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    for (const m of consoleMessages) console.log(m);
    if (!frame60) {
        console.error("FAIL: the intro did not reach frame 60 within 90 s");
        process.exitCode = 1;
        return;
    }
    console.log("osiris web: the intro reached frame 60 " + seconds + " s after it started");

    // The picture the movie put on the screen, as a player sees it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: "/tmp/osiris-web-movie.png", fullPage: false });
    const shot = fs.statSync("/tmp/osiris-web-movie.png").size;
    console.log("osiris web: screenshot written to /tmp/osiris-web-movie.png (" + shot + " bytes)");

    // Escape skips the movie, as in the original (any key does).
    const mark = consoleMessages.length;
    await page.keyboard.press("Escape");
    const done = await until(
        () => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: movie Intro_big done")),
        30_000,
        100
    );

    // The menu logs `osiris web: page <name>` when it is built, which happens before the
    // intro starts, so that line cannot show the hand-over. The menu answering with its
    // buttons can: the movie screen draws none.
    let buttons = [];
    const menuDeadline = Date.now() + 30_000;
    while (done && buttons.length === 0 && Date.now() < menuDeadline) {
        buttons = await menuButtons();
        if (buttons.length === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    for (const m of consoleMessages.slice(mark)) console.log(m);

    const panic = panicLine();
    if (panic) {
        console.error("FATAL: wasm panic detected: " + panic);
        process.exitCode = 1;
    } else if (!done) {
        console.error("FAIL: Escape did not skip the intro (no 'osiris web: movie Intro_big done')");
        process.exitCode = 1;
    } else if (buttons.length === 0) {
        console.error("FAIL: the menu never came up after the intro");
        process.exitCode = 1;
    } else if (shot < 50_000) {
        console.error("FAIL: the movie screenshot is only " + shot + " bytes, likely blank");
        process.exitCode = 1;
    } else {
        console.log("osiris web: the intro played, Escape skipped it, the menu is up (" + buttons.length + " buttons)");
    }
}

async function run() {
    await new Promise((resolve) => server.listen(PORT, resolve));

    /**
     * Ask the server for `rawPath` exactly as written, with no URL cleaning on the
     * way, so a `..` in the path really reaches the handler. Returns the status and
     * the line the handler logged for it, so a 404 can be told apart from "the file
     * happens not to exist".
     */
    function probe(rawPath) {
        return new Promise((resolve) => {
            const req = http.request({ host: "127.0.0.1", port: PORT, path: rawPath }, (res) => {
                res.resume();
                res.on("end", () => resolve({ status: res.statusCode, logged: requestLog.at(-1) ?? "" }));
            });
            req.on("error", () => resolve({ status: 0, logged: "" }));
            req.end();
        });
    }

    // GitHub Pages answers 404 for everything outside the site prefix and serves
    // nothing above the site folder. `new URL` already collapses a plain `..`, so an
    // encoded separator is what still reaches the handler with a `..` in it. These
    // probes are deliberate, so wipe the log afterwards.
    const problems = [];
    const traversal = await probe(BASE + "..%2F..%2Fpackage.json");
    if (!traversal.logged.includes("leaves the served folder")) {
        problems.push("a ../ path was not refused (" + traversal.logged + ")");
    }
    if (BASE !== "/") {
        const outside = await probe("/not-the-site/index.html");
        if (!outside.logged.includes("outside ")) {
            problems.push("a path outside " + BASE + " was not refused (" + outside.logged + ")");
        }
    }
    requestLog.length = 0;

    if (problems.length > 0) {
        console.error("FAIL: " + problems.join("; "));
        process.exitCode = 1;
        return;
    }
    console.log("osiris web: base OK (" + BASE + ")");

    try {
        // --use-angle=gl forces ANGLE to use OpenGL (WebGL2) so headless Chrome
        // actually renders WebGL content. Without it, the canvas is blank.
        // --no-sandbox is needed when running as root in CI containers.
        // A GPU run (web-gpu-fps) asks ANGLE for Metal and for the GPU itself instead,
        // and fails below when the page still got a software adapter.
        const args = GPU
            ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox"]
            : ["--use-angle=gl", "--no-sandbox"];
        // A viewport run also pins the device pixel ratio to 1: the canvas is sized from
        // it, and a retina screen would otherwise double the bitmap under the run.
        if ((VIEWPORT?.length ?? 0) > 0) args.push("--force-device-scale-factor=1");
        browser = await chromium.launch({ headless: !HEADED, args });
        // A viewport run pins the device pixel ratio to 1: the size the game reports back is
        // the canvas bitmap, and a retina screen would otherwise turn 1920x1080 into
        // 3840x2160 and read the menu's coordinates against the wrong scale. The maths at
        // other ratios is `fit-test.mjs`'s job, not this run's.
        if ((VIEWPORT?.length ?? 0) > 0) {
            const context = await browser.newContext({
                viewport: { width: VIEWPORT[0].width, height: VIEWPORT[0].height },
                deviceScaleFactor: 1,
            });
            page = await context.newPage();
        } else {
            page = await browser.newPage();
        }

        page.on("console", (msg) => {
            const line = `[${msg.type().slice(0, 1)}] ${msg.text()}`;
            consoleMessages.push(line);
            // The menu's page changes are printed as they happen, so a failed walk of the
            // menu shows where it went instead of only where it stopped.
            if (line.includes("osiris web: page ")) console.log("osiris web: saw " + line);
        });

        try {
            await page.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        } catch {
            // Timeout is fine; we poll console messages below.
        }

        if (VIEWPORT) {
            const ratio = await page.evaluate(() => window.devicePixelRatio);
            console.log("osiris web: the page's device pixel ratio is " + ratio);
            if (ratio !== 1) {
                console.error("FAIL: the page's device pixel ratio is " + ratio + ", and this run wants 1");
                process.exitCode = 1;
                return;
            }
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
        for (const r of requestLog) {
            if (r.startsWith("404")) console.log("REQUEST " + r);
        }

        if (!foundReady) {
            console.error("FAIL: never saw 'osiris web: ready'");
            process.exitCode = 1;
            return;
        }

        // ── A file read synchronously off the page's main thread ──────
        // `files.js` has to hand the game a file's bytes at once, from the `File` the
        // picker or browser storage gave the page. A synchronous `XMLHttpRequest` for
        // the file's `blob:` URL is the only way to do that outside a Worker (`web-lazy`
        // design 1), so prove it here, on 40 MB, before anything is built on it.
        if (SYNCREAD) {
            const sync = await page.evaluate(async (base) => {
                const { register, read } = await import(base + "files.js");
                const size = 40 * 1024 * 1024;
                const data = new Uint8Array(size);
                // `getRandomValues` fills at most 65536 bytes per call.
                for (let at = 0; at < size; at += 65536) {
                    crypto.getRandomValues(data.subarray(at, Math.min(at + 65536, size)));
                }
                const url = "/PharaohData/Data/sync-read.dat";
                register(url, new File([data], "sync-read.dat"));
                const started = performance.now();
                const bytes = read(url);
                const ms = Math.round(performance.now() - started);
                let firstDifference = -1;
                for (let i = 0; i < size; i += 1) {
                    if (bytes[i] !== data[i]) {
                        firstDifference = i;
                        break;
                    }
                }
                // A path the page never registered is an error that names the path.
                let missing = "";
                try {
                    read("/PharaohData/Data/not-registered.dat");
                } catch (error) {
                    missing = String(error.message ?? error);
                }
                return { ms, length: bytes.length, size, firstDifference, missing };
            }, BASE);

            const named = sync.missing.includes("/PharaohData/Data/not-registered.dat");
            if (sync.length !== sync.size || sync.firstDifference !== -1 || !named) {
                console.error(
                    "FAIL: the synchronous read did not give the file back (" +
                    JSON.stringify(sync) + ")"
                );
                process.exitCode = 1;
            } else if (process.exitCode !== 1) {
                console.log("osiris web: sync read OK (40 MB in " + sync.ms + " ms)");
            }
            return;
        }

        // ── Sound: gesture, open a device, play a beep (web-sound task 1.7) ──
        // Chromium only starts an AudioContext after a real user gesture, so click the page
        // first, then open the game's output device and play the generated beep from the store.
        await page.mouse.click(20, 20);
        const sound = await page.evaluate(async (base) => {
            const wasm = await import(base + "pkg/osiris.js");
            const opened = wasm.debug_audio_open();
            if (opened) {
                wasm.debug_audio_beep();
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
            return {
                opened,
                state: globalThis.osirisAudio ? globalThis.osirisAudio.state() : "missing",
            };
        }, BASE);
        if (!sound.opened) {
            console.log("SKIP: no audio device");
        } else if (sound.state !== "running") {
            console.error("FAIL: no sound (" + JSON.stringify(sound) + ")");
            process.exitCode = 1;
        } else if (process.exitCode !== 1) {
            console.log("osiris web: sound OK");
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

        // ── Folder walker (fake entries, no game data needed) ─────────
        // Drop one fake folder "Pharaoh" containing 150 files at the root and
        // a subfolder Data with a.sg3. The reader hands out the entries in
        // batches of 100, then 50, then [] — Chromium caps a batch at 100, so a
        // single readEntries call would lose files.
        const walkResult = await page.evaluate(async (base) => {
            const { filesFromDrop, filesFromInput } = await import(base + "folder.js");

            const fileEntry = (name) => ({
                isFile: true,
                isDirectory: false,
                name,
                file(ok) { ok(new File([new Uint8Array([1])], name)); },
            });

            const dirEntry = (name, batches) => {
                const pending = batches.slice();
                return {
                    isFile: false,
                    isDirectory: true,
                    name,
                    createReader() {
                        return {
                            readEntries(ok) {
                                ok(pending.length ? pending.shift() : []);
                            },
                        };
                    },
                };
            };

            const first = [];
            for (let i = 0; i < 100; i++) first.push(fileEntry("f" + i + ".sg3"));
            const second = [];
            for (let i = 100; i < 150; i++) second.push(fileEntry("f" + i + ".sg3"));
            second.push(dirEntry("Data", [[fileEntry("a.sg3")]]));
            const pharaoh = dirEntry("Pharaoh", [first, second, []]);

            const dropped = await filesFromDrop({
                items: [{ webkitGetAsEntry: () => pharaoh }],
                files: [],
            });

            // The same folder by file input must give the same relative path.
            const inputFile = new File([new Uint8Array([1])], "a.sg3");
            Object.defineProperty(inputFile, "webkitRelativePath", {
                value: "Pharaoh/Data/a.sg3",
            });
            const fromInput = filesFromInput([inputFile]);

            return {
                count: dropped.length,
                dropPath: dropped.find((e) => e.path.endsWith("Data/a.sg3"))?.path ?? null,
                inputPath: fromInput[0]?.path ?? null,
                prefixed: dropped.filter((e) => e.path.startsWith("Pharaoh/")).length,
            };
        }, BASE);

        if (
            walkResult.count !== 151 ||
            walkResult.dropPath !== "Data/a.sg3" ||
            walkResult.inputPath !== "Data/a.sg3" ||
            walkResult.prefixed !== 0
        ) {
            console.error("FAIL: folder walk " + JSON.stringify(walkResult));
            process.exitCode = 1;
        } else if (process.exitCode !== 1) {
            console.log("osiris web: folder walk OK");
            // ── Synthetic drop on #start ──────────────────────────────
            // Synthetic DataTransfer items have no file system entries, so this
            // exercises the fallback to dataTransfer.files and loadFolder.
            const messageMark = consoleMessages.length;
            await page.evaluate(() => {
                const start = document.getElementById("start");
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(new File(["x"], "x.txt", { type: "text/plain" }));
                start.dispatchEvent(new DragEvent("drop", {
                    dataTransfer,
                    bubbles: true,
                    cancelable: true,
                }));
            });

            // A lone x.txt is not a Pharaoh folder. The page must refuse it before it
            // reads anything: the message in #status, #start still on screen, and no
            // attempt to start the game (that would log the canvas and call start_game).
            const sawRefusal = () =>
                consoleMessages.slice(messageMark).some((m) =>
                    m.includes("no Data/Pharaoh_General.sg3 among 1 files")
                );
            let sawRefusalLine = false;
            const dropDeadline = Date.now() + 15_000;
            while (Date.now() < dropDeadline) {
                await new Promise((r) => setTimeout(r, 100));
                if (sawRefusal()) {
                    sawRefusalLine = true;
                    break;
                }
            }

            let dropState = { visible: false, status: "" };
            const stateDeadline = Date.now() + 15_000;
            while (Date.now() < stateDeadline) {
                dropState = await page.evaluate(() => {
                    const start = document.getElementById("start");
                    return {
                        visible: !!start && getComputedStyle(start).display !== "none",
                        status: document.getElementById("status")?.textContent ?? "",
                    };
                });
                if (dropState.visible && dropState.status.includes("does not hold Pharaoh")) break;
                await new Promise((r) => setTimeout(r, 100));
            }

            const sawFailure = dropState.status.includes("does not hold Pharaoh");
            const started = consoleMessages.slice(messageMark).some((m) =>
                m.includes("osiris web: set canvas")
            );

            for (const m of consoleMessages.slice(messageMark)) {
                console.log(m);
            }

            if (!sawRefusalLine || !sawFailure || !dropState.visible || started) {
                console.error(
                    "FAIL: folder drop " +
                        JSON.stringify({ sawRefusalLine, sawFailure, started, ...dropState })
                );
                process.exitCode = 1;
            } else {
                console.log("osiris web: drop OK");
            }
        }

        // ── Game data smoke test (when OSIRIS_DATA is set) ────────────
        // Staging copies game files into the served folder, so it only works when we
        // serve web/ itself, never the published site.
        const osirisData = process.env.OSIRIS_DATA;
        if (INTRO && !(osirisData && fs.existsSync(osirisData))) {
            // The intro needs the install's BINKS/High/Intro_big.bik.
            console.log("SKIP: no game data");
            return;
        }
        if (process.env.SMOKE_ROOT && osirisData && fs.existsSync(osirisData)) {
            console.log("SKIP: game data needs SMOKE_ROOT unset");
        } else if (osirisData && fs.existsSync(osirisData)) {
            console.log("osiris web: loading game data from " + osirisData);

            /** @type {string[]} */
            const allPaths = walk(osirisData, osirisData);
            const relPaths = filterEssential(allPaths);
            console.log("osiris web: " + allPaths.length + " total files, mounting " + relPaths.length + " essential");

            if (DIRECT) {
                // Load the page the way the README does, so `?mission=3` is read by the
                // page's own code rather than faked in the test.
                consoleMessages.length = 0;
                await page
                    .goto(`http://localhost:${PORT}${BASE}?mission=3`, { waitUntil: "domcontentloaded", timeout: 30_000 })
                    .catch(() => { /* polling for the ready line below */ });
                if (!(await until(() => consoleMessages.some((m) => m.includes("osiris web: ready")), 30_000))) {
                    console.error("FAIL: the page never got ready with ?mission=3");
                    process.exitCode = 1;
                    return;
                }
            }

            // Stage files on disk so the HTTP server can serve them.
            const stagingDir = stageFiles(osirisData, relPaths, WRAP);
            console.log("osiris web: staged to " + stagingDir);

            if (REMEMBER) {
                await runRemember(stagingDir);
                return;
            }

            if (PICK) {
                // Give the page the whole staged folder through its own picker, so `main.js`
                // finds the game root and sizes the canvas itself. A wrapped run puts the game
                // two folders above the game files and a stray file next to them, which must be
                // skipped without being read.
                if (WRAP) fs.writeFileSync(path.join(stagingDir, WRAP, "stray.zip"), Buffer.from([0, 1, 2]));
                // The bar has to be watched before the picker is given the folder: the read
                // starts as soon as the picker changes.
                await watchProgress();
                await page.setInputFiles("#folder", stagingDir).catch((err) => {
                    console.error("FAIL: could not give the picker " + stagingDir + ": " + err.message);
                    process.exitCode = 1;
                });
                if (process.exitCode === 1) return;

                // The screenshot the issue asks for, taken while the files are still being
                // read, so the bar is on it.
                const loading = await captureLoading("/tmp/osiris-web-loading.png");
                if (!loading) {
                    console.error("FAIL: the page never showed the progress bar while it read the game files");
                    process.exitCode = 1;
                    return;
                }
                if (loading.gone) {
                    console.error(
                        "FAIL: the files were read before the loading screenshot could be taken" +
                        " (the bar last read " + JSON.stringify(loading.text) + ")"
                    );
                    console.error("FAIL: the page says " + JSON.stringify(await page.evaluate(() =>
                        document.getElementById("status").textContent)));
                    for (const m of consoleMessages.slice(messageMark)) console.log(m);
                    process.exitCode = 1;
                    return;
                }
                console.log(
                    "osiris web: loading bar OK (" + loading.text +
                    ", /tmp/osiris-web-loading.png " + loading.bytes + " bytes)"
                );

                const found = await until(
                    () => consoleMessages.some((m) => m.includes("osiris web: game root '")),
                    120_000,
                    500
                );
                const rootLine = consoleMessages.find((m) => m.includes("osiris web: game root '"));
                const reading = /reading (\d+) of (\d+) files/.exec(rootLine ?? "");
                for (const m of consoleMessages) console.log(m);
                if (!found || !rootLine) {
                    console.error("FAIL: the page never found the game root in the chosen folder");
                    process.exitCode = 1;
                    return;
                }
                const wanted = relPaths.length + (WRAP ? 1 : 0);
                if (!reading || Number(reading[1]) !== relPaths.length || Number(reading[2]) !== wanted) {
                    console.error("FAIL: the page did not read " + relPaths.length + " of " + wanted + " files (" + rootLine + ")");
                    process.exitCode = 1;
                    return;
                }
                console.log(
                    WRAP
                        ? "osiris web: the page found the root under " + WRAP + " and skipped the stray file"
                        : "osiris web: the page found the root and read all " + relPaths.length + " files"
                );

                // The pick only finds the files; the title screen's Enter button starts the
                // game, as a player would press it.
                const entered = await enterGame();
                if (!entered) {
                    console.error("FAIL: the title screen never offered 'Enter the game' after the pick");
                    process.exitCode = 1;
                    return;
                }

                // The page is still reading those files (775 MB on this machine), so the
                // staging folder has to stay on disk until it has read them all and
                // started the game. Deleting it here made every later read fail, and the
                // page then sat on an empty status line with nothing to show.
                const readAll = await until(
                    () => panicLine() !== null || consoleMessages.some((m) => m.includes("osiris web: set canvas to")),
                    300_000,
                    500
                );
                if (!readAll) {
                    for (const m of consoleMessages) console.log(m);
                    console.error(
                        "FAIL: the page did not finish reading the game files" +
                        " (status: " + ((await page.textContent("#status")) ?? "") + ")"
                    );
                    fs.rmSync(stagingDir, { recursive: true, force: true });
                    process.exitCode = 1;
                    return;
                }
            } else {
                // Mount all game files lazily: each fetched file becomes a browser `File`,
                // the page registers it, and the store is told only its path and size. The
                // game's read of a path then copies just that file into wasm memory, so the
                // whole install is never in memory at once (`web-lazy`). The bytes live in
                // the page's heap, not in wasm memory, which is what the soak memory
                // number measures.
                await page.evaluate(async ([paths, base]) => {
                    let count = 0;
                    let bytes = 0;
                    const started = performance.now();
                    for (const rel of paths) {
                        const vfsPath = "PharaohData/" + rel;
                        const resp = await fetch(base + "game-data-staging/PharaohData/" + rel);
                        if (!resp.ok) {
                            console.error("Failed to fetch " + rel + ": " + resp.status);
                            continue;
                        }
                        const file = new File([await resp.blob()], rel.split("/").pop());
                        osirisFiles.register("/" + vfsPath, file);
                        mount_lazy(vfsPath, file.size);
                        count++;
                        bytes += file.size;
                        if (count % 50 === 0) {
                            console.log("osiris web: indexed " + count + "/" + paths.length + " files");
                        }
                    }
                    console.log(
                        "osiris web: indexed " + count + " files (" +
                        Math.round(bytes / (1024 * 1024)) + " MB) in " +
                        Math.round(performance.now() - started) + " ms"
                    );
                }, [relPaths, BASE]);
            }

            // Clean up staging directory.
            fs.rmSync(stagingDir, { recursive: true });

            console.log(
                PICK
                    ? "osiris web: the page read the game files from the folder picker, starting game..."
                    : "osiris web: all essential game files mounted, starting game..."
            );

            if (!PICK) {
                // Set canvas dimensions before starting the game. The canvas starts hidden in
                // the page and main.js shows it once the game starts; a run that starts the
                // game itself has to show it too, or it keeps no layout and every menu click
                // lands at its own coordinates on the page instead of the button.
                await page.evaluate(() => {
                    const canvas = document.getElementById('osiris');
                    if (canvas) {
                        canvas.hidden = false;
                        canvas.width = 1280;
                        canvas.height = 768;
                        canvas.style.width = "1280px";
                        canvas.style.height = "768px";
                    }
                });
            }

            if (DIRECT) {
                await runDirectMission({ alreadyStarted: PICK });
                return;
            }

            if (INTRO || MENU) {
                // Give the canvas the keyboard (winit's web canvas takes keys when it is
                // focused). This click is before the game starts, so it cannot skip the
                // movie: a click does. The menu mode needs the keys too, because it
                // presses Escape on the intro that plays before the menu.
                await page.mouse.click(640, 384);
            }

            // Start the game — returns a Promise on wasm. A run that handed the folder to the
            // page's picker has already started the game that way: starting it twice throws
            // "EventLoop can't be recreated".
            if (!PICK) {
                await page.evaluate(() => start_game());
            }

            if (INTRO) {
                await runIntroMovie();
                return;
            }

            if (TRACE) {
                await runTrace();
                return;
            }

            if (SOAK) {
                await runSoakMission();
                return;
            }

            if (MENU) {
                await runMenuMission();
                if (SAVES && process.exitCode !== 1) await runSaves();
                if (VIEWPORT && process.exitCode !== 1) await runViewportChecks();
                return;
            }

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
                if (!checkMenuTime()) process.exitCode = 1;
                // Real game sound (web-sound task 1.9): the game's own audio must be running
                // and no track or effect may have failed to open.
                const audioState = await page.evaluate(() =>
                    globalThis.osirisAudio ? globalThis.osirisAudio.state() : "missing"
                );
                const playErrors = consoleMessages.filter((m) => m.includes("could not play"));
                for (const m of playErrors) console.error(m);
                if (playErrors.length > 0) {
                    console.error("FAIL: the game could not play " + playErrors.length + " sound file(s)");
                    process.exitCode = 1;
                } else if (audioState !== "running") {
                    console.error("FAIL: no running AudioContext at the main menu (" + audioState + ")");
                    process.exitCode = 1;
                } else {
                    console.log("osiris web: game sound OK (" + audioState + ")");
                }

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
        // Every flow starts the game, so the page's gfx line is here by now. A GPU run
        // checks it before the browser goes away.
        reportGfx();
        try {
            if (page) await page.close();
            if (browser) await browser.close();
        } catch { /* ignore cleanup errors */ }
        server.close();
    }
}

run().then(() => process.exit(process.exitCode || 0));
