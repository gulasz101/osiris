# AGENTS.md: rules for coding agents in this repo

Read this whole file at the start of every run. It is short on purpose.

## What this repo is
- Osiris: a Rust engine for Pharaoh (1999) + Cleopatra. Fork of `joemalott/osiris`, GPL-3.0-or-later.
- Our goal: the same game in a web browser. The player drops their own Pharaoh folder into the
  page; the game reads it in memory. Nothing is uploaded, nothing from the game is in git.
- We port, we do not redesign. Do not change game rules (`crates/osiris-sim`) or how the game
  looks. Change only what the browser needs.
- The desktop build must keep working. Every change keeps `cargo test --workspace` green.

## How we work (dark room)
- Work on branch `main` only. No other branches, no pull requests. Commit and push to `main`.
- Start of every run:
  1. `git checkout main && git pull --ff-only`
  2. Read your Paperclip issue. It names one OpenSpec change, for example `web-compiles`.
  3. `scripts/openspec instructions apply --change <name> --json`: it lists the tasks and which are
     done. Read `openspec/changes/<name>/proposal.md`, `design.md` (if there is one) and `tasks.md`.
  4. Search Hindsight (bank `coding-agent::osiris`) and docs-mcp for what the next task touches.
- Then do the **first unchecked task** in `tasks.md`, and only that one:
  1. Make the change. Look up every library call in docs-mcp first (table below).
  2. Run the check the task names (or `scripts/check.sh`).
  3. Tick it in `tasks.md` (`- [ ]` -> `- [x]`).
  4. `git add -A && git commit -m "<change>: <task number> <what you did>" && git push`
  5. Next task. Small commits matter: a run can stop at any time (turn cap, timeout), and the next
     run continues from `tasks.md`.
- When every task is ticked:
  1. `scripts/check.sh` must end with `CHECK OK`.
  2. `scripts/openspec archive <name> -y`, then commit and push.
  3. Comment on the issue and set it `done` (your Paperclip instructions say how).
- If a task is wrong or impossible: do not invent another design. Commit what works (the check
  must still pass), write what is missing and why in an issue comment, set the issue `blocked`.

## Docs first (docs-mcp), then Firecrawl
Before you write code against a library, search it in docs-mcp (`mcp__docs__search_docs`, or the
`docs-search` skill). Use these versions: they are the ones in `Cargo.lock`. Never guess an API
from memory; these crates change between versions.

| Crate / topic | Version | docs-mcp library |
|---|---|---|
| wgpu | 30.0.1 | `wgpu` |
| winit (web: `winit::platform::web`) | 0.30.13 | `winit` |
| wasm-bindgen (guide + API) | 0.2.128 (docs 0.2.130) | `wasm-bindgen` |
| wasm-bindgen-futures | 0.4.78 | `wasm-bindgen-futures` |
| web-sys / js-sys | 0.3.105 | `web-sys`, `js-sys` |
| getrandom | 0.3.4 and 0.4.3 | `getrandom` |
| web-time | 1.1.0 | `web-time` |
| console_error_panic_hook | 0.1.7 | `console_error_panic_hook` |
| rodio / cpal (sound) | 0.22.2 / 0.17.3 | `rodio`, `cpal` |
| File API, drag and drop, IndexedDB, Web Audio, WebGPU | - | `mdn-web-apis` |
| OpenSpec | 2.0.0 | `openspec` |

If docs-mcp has nothing, use the `web-search` skill (our Firecrawl). Say in the issue comment
which docs you used.

## Repo map
- `crates/osiris-formats`: readers for the game files (`.sg3`, `.555`, `.map`, text). Already
  builds for wasm.
- `crates/osiris-sim`: game rules. Already builds for wasm. Do not change behaviour.
- `crates/osiris-render`: wgpu renderer. `crates/osiris-ui`: widgets.
- `crates/osiris-audio`: sound (rodio). `crates/osiris-bink`: movies.
- `crates/osiris-app`: the program (`src/main.rs`, window, event loop, menus). Most browser work
  is here.
- `crates/osiris-tools`: desktop command line tools. Leave them alone.
- `openspec/`: the plan. `openspec/changes/<name>/` is current work, `openspec/specs/` is what is
  already true. The PM (Claude Code) writes the changes; you implement them.
- `web/` (after change `web-page`): the HTML page and its JavaScript.

## Rust rules
- Browser-only code goes behind `#[cfg(target_arch = "wasm32")]`, desktop-only code behind
  `#[cfg(not(target_arch = "wasm32"))]`. Browser-only crates go under
  `[target.'cfg(target_arch = "wasm32")'.dependencies]`.
- Never run `cargo update`. Never edit `Cargo.lock` by hand. Adding a dependency to a
  `Cargo.toml` updates the lock file by itself; that is fine.
- Keep the style of the code around you. Comments here are full English sentences.
- No new `unsafe`, no `unwrap()` in non-test code where the surrounding code returns `Result`.

## Game files: never in git
- No file from the game (`.sg3`, `.555`, `.map`, `.sav`, `.pak`, `.bik`, `.smk`, `.wav`, `.mp3`,
  `Pharaoh_Text.*` and so on) goes into git, test fixtures, comments or logs. `scripts/check.sh`
  fails if one is tracked. Tests use bytes made up in the test.
- Real game data may exist on this machine outside the repo (`$OSIRIS_DATA`, see your issue).
  Read it, never copy it into the repo.
- The only exception is the smoke test's temp folder `web/game-data-staging/`. It is in
  `.gitignore`. Never `git add -f` it.
- Local git hooks block any commit or push with a game file, a file over 5 MB, or a path under
  `game-data-staging/` or `PharaohData/`. If a hook blocks you, remove the file from the commit
  (`git rm --cached <file>`, then `git commit --amend`). Never use `--no-verify`.

## Commands
- Native tests: `cargo test --workspace` (takes a few minutes; give the bash call `timeout: 1500`).
- Browser compile check: `cargo check --target wasm32-unknown-unknown -p osiris-app`
- The gate: `scripts/check.sh` (after change `web-compiles` exists). It must end with `CHECK OK`.
- OpenSpec: always `scripts/openspec ...` (pinned 2.0.0). Use only `list`, `status`, `show`,
  `instructions apply`, `validate`, `archive -y`. Never run `scripts/openspec` with no arguments
  or `init`: they ask questions and wait forever.

## Commands that hang (never do these)
- Write files with the `write` tool, never with `cat <<EOF` in bash. A heredoc has hung a whole
  run here before (GUL-1537).
- No `cargo watch`, no `cargo run` of the desktop game (it opens a window and waits), no server in
  the foreground. A web server or browser test always runs with `timeout 120`.
- No interactive commands (`git rebase -i`, `git add -p`, editors).

## When you are stuck
- Same error three times: stop. Commit what works, comment the exact error and what you tried,
  set the issue `blocked`.
- Learned something durable (a wasm gotcha, an API that differs from what you expected)? Retain it
  in Hindsight with `hindsight_ingest_document`.
