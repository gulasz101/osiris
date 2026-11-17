// Unit test for the game-root search in web/folder.js. No browser, no game data:
// every path below is made up. Run with `node web/tests/folder-test.mjs`.
import { findGameRoot, filesUnder } from "../folder.js";

let failures = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        console.error("FAIL: " + name + ": got " + a + ", want " + e);
        failures += 1;
    }
}

/** A list entry with a path only; the search never opens the file. */
function entry(path) {
    return { path, file: null };
}

// The chosen folder itself holds Data/.
check(
    "root at depth 0",
    findGameRoot([entry("Data/Pharaoh_General.sg3"), entry("Data/Pharaoh_Text.eng")]),
    ""
);

// One folder above the game files.
check(
    "root at depth 1",
    findGameRoot([entry("Pharaoh/Pharaoh.exe"), entry("Pharaoh/Data/Pharaoh_General.sg3")]),
    "Pharaoh/"
);

// The GOG tree Wojtek picked: the game is two levels down, in Akhenaten/resources.
const gog = [
    entry("pharaoh-plus-cleopatra/Akhenaten/resources/Data/Pharaoh_General.sg3"),
    entry("pharaoh-plus-cleopatra/Akhenaten/resources/Data/Pharaoh_Text.eng"),
    entry("pharaoh-plus-cleopatra/Akhenaten/resources/AUDIO/Wavs/a.wav"),
    entry("pharaoh-plus-cleopatra/extras/manual.pdf"),
    entry("pharaoh-plus-cleopatra/akhenaten.linux"),
];
check(
    "root at depth 3 (GOG folder)",
    findGameRoot(gog),
    "pharaoh-plus-cleopatra/Akhenaten/resources/"
);

// Names are compared case-insensitively, so a lower-case install works too.
check(
    "lower-case data folder",
    findGameRoot([entry("pharaoh/data/pharaoh_general.sg3")]),
    "pharaoh/"
);

// A "Data" that only ends another path part is not the root.
check(
    "no root (myData is not Data)",
    findGameRoot([entry("myData/Pharaoh_General.sg3")]),
    null
);

check("no root", findGameRoot([entry("x.txt"), entry("extras/manual.pdf")]), null);
check("no root in an empty list", findGameRoot([]), null);

// Only the files under the root survive, with the root prefix removed.
check(
    "files under the GOG root",
    filesUnder("pharaoh-plus-cleopatra/Akhenaten/resources/", gog).map((e) => e.path),
    [
        "Data/Pharaoh_General.sg3",
        "Data/Pharaoh_Text.eng",
        "AUDIO/Wavs/a.wav",
    ]
);
check(
    "files under the chosen folder",
    filesUnder("", [entry("Data/Pharaoh_General.sg3")]).map((e) => e.path),
    ["Data/Pharaoh_General.sg3"]
);
check("files under a missing root", filesUnder(null, gog), []);

if (failures > 0) {
    console.error(failures + " folder test(s) failed");
    process.exit(1);
}
console.log("folder-test: OK");
