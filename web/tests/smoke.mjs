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
const DIRECT = MISSION_MODE === "direct";
const MENU = MISSION_MODE === "menu";
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
async function runMenuMission() {
    // The intro is the first screen of a fresh start, so it is in the way here too.
    await skipIntro();
    const family = await waitPage("family", 60_000, 0);
    if (!family) {
        console.error("FAIL: the registry page never came up");
        process.exitCode = 1;
        return;
    }
    const registry = await menuButtons();
    console.log("osiris web: the registry offers " + JSON.stringify(registry.slice(0, 2)));

    // A new family, named by typing as a player would.
    let from = consoleMessages.length;
    await clickMenu("Go(NewFamily)");
    if (!(await waitPage("newfamily", 30_000, from))) {
        console.error("FAIL: the new family page never came up");
        process.exitCode = 1;
        return;
    }
    from = consoleMessages.length;
    await page.keyboard.type("Smoke");
    await page.keyboard.press("Enter");
    if (!(await waitPage("family", 60_000, from))) {
        console.error("FAIL: the registry never came back after naming the family");
        process.exitCode = 1;
        return;
    }

    // The family's own file proves the typed name reached the game.
    const made = await page.evaluate(() => debug_read_user("families/smoke/name.txt"));
    console.log("osiris web: the family's name.txt reads " + JSON.stringify(made ?? null));

    // Pick the family just made and go on to its menu.
    from = consoleMessages.length;
    await clickMenu('Choose(Family("');
    await clickMenu("Choose(Family", true);
    if (!(await waitPage("main", 60_000, from))) {
        console.error("FAIL: the family's menu never came up after choosing it");
        for (const m of consoleMessages) console.log(m);
        process.exitCode = 1;
        return;
    }

    // The family history's mission list. Explore History's tab opens it directly, which is
    // the way to a mission that does not play the period's opening movie first.
    if (!(await clickMenuTo("Go(HistoryPeriods)", "historyperiods")) || !(await clickMenuTo("Go(Campaign)", "campaign"))) {
        console.error("FAIL: the campaign's mission list never came up");
        for (const m of consoleMessages) console.log(m);
        process.exitCode = 1;
        return;
    }
    // The campaign's first mission, and its briefing: a click on the row picks it and the
    // list's arrow starts it.
    await clickMenu("Choose(Mission");
    if (!(await clickMenuTo("Choose(StartMission)", "briefing", { ms: 60_000 }))) {
        console.error("FAIL: the briefing never came up");
        process.exitCode = 1;
        return;
    }

    // On to the city. A mission opens messages when it starts, and the game stands still
    // while one is up, so press Escape now and then and let the city run.
    from = consoleMessages.length;
    await clickMenu("ToCity");
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
        browser = await chromium.launch({
            args: ["--use-angle=gl", "--no-sandbox"],
        });
        page = await browser.newPage();

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

            if (WRAP) {
                // Give the page the whole staged folder, two folders above the game files,
                // through its own picker: main.js has to find the root itself. A stray file
                // next to the game folder must be skipped without being read.
                fs.writeFileSync(path.join(stagingDir, WRAP, "stray.zip"), Buffer.from([0, 1, 2]));
                await page.setInputFiles("#folder", stagingDir).catch((err) => {
                    console.error("FAIL: could not give the picker " + stagingDir + ": " + err.message);
                    process.exitCode = 1;
                });
                if (process.exitCode === 1) return;

                const found = await until(
                    () => consoleMessages.some((m) => m.includes("osiris web: game root '")),
                    120_000,
                    500
                );
                const rootLine = consoleMessages.find((m) => m.includes("osiris web: game root '"));
                const reading = /reading (\d+) of (\d+) files/.exec(rootLine ?? "");
                for (const m of consoleMessages) console.log(m);
                if (!found || !rootLine) {
                    console.error("FAIL: the page never found the game root in " + WRAP);
                    process.exitCode = 1;
                    return;
                }
                if (!reading || Number(reading[1]) !== relPaths.length || Number(reading[2]) !== relPaths.length + 1) {
                    console.error("FAIL: the page did not skip the stray file (" + rootLine + ")");
                    process.exitCode = 1;
                    return;
                }
                console.log("osiris web: the page found the root under " + WRAP + " and skipped the stray file");

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
                        "FAIL: the page did not finish reading the game files under " + WRAP +
                        " (status: " + ((await page.textContent("#status")) ?? "") + ")"
                    );
                    fs.rmSync(stagingDir, { recursive: true, force: true });
                    process.exitCode = 1;
                    return;
                }
            } else {
                // Mount all game files by fetching from the test server and using mount_file.
                // Use paths like "PharaohData/..." so mount_file creates /PharaohData/...
                await page.evaluate(async ([paths, base]) => {
                    let count = 0;
                    for (const rel of paths) {
                        const vfsPath = "PharaohData/" + rel;
                        const resp = await fetch(base + "game-data-staging/PharaohData/" + rel);
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
                }, [relPaths, BASE]);
            }

            // Clean up staging directory.
            fs.rmSync(stagingDir, { recursive: true });

            console.log(
                WRAP
                    ? "osiris web: the page read the game files from the folder picker, starting game..."
                    : "osiris web: all essential game files mounted, starting game..."
            );

            // Set canvas dimensions before starting the game (winit reads client_width/height).
            // The canvas starts hidden in the page and main.js shows it once the game starts;
            // a run that starts the game itself has to show it too, or it keeps no layout and
            // every menu click lands at its own coordinates on the page instead of the button.
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

            if (DIRECT) {
                await runDirectMission({ alreadyStarted: WRAP !== "" });
                return;
            }

            if (INTRO || MENU) {
                // Give the canvas the keyboard (winit's web canvas takes keys when it is
                // focused). This click is before the game starts, so it cannot skip the
                // movie: a click does. The menu mode needs the keys too, because it
                // presses Escape on the intro that plays before the menu.
                await page.mouse.click(640, 384);
            }

            // Start the game — returns a Promise on wasm. A wrapped run hands the folder to
            // the page's picker, and the page has already started the game itself by now:
            // starting it twice throws "EventLoop can't be recreated".
            if (!WRAP) {
                await page.evaluate(() => start_game());
            }

            if (INTRO) {
                await runIntroMovie();
                return;
            }

            if (MENU) {
                await runMenuMission();
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
        try {
            if (page) await page.close();
            if (browser) await browser.close();
        } catch { /* ignore cleanup errors */ }
        server.close();
    }
}

run().then(() => process.exit(process.exitCode || 0));
