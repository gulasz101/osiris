# AGENTS.md: rules for coding agents in this repo

Read this whole file at the start of every run. It is short on purpose.

## What this repo is
- Osiris: a Rust engine for Pharaoh (1999) + Cleopatra. Fork of `joemalott/osiris`, GPL-3.0-or-later.
- Our goal: the same game in a web browser. The player drops their own Pharaoh folder into the
  page; the game reads it in memory. Nothing is uploaded, nothing from the game is in git.
- We port, we do not redesign. Do not change game rules (`crates/osiris-sim`) or how the game
  looks. Change only what the browser needs.
- The desktop build must keep working. Every change keeps `cargo test --workspace` green.

## How we work (code factory)
- All work comes as a code factory work order (homelab-2nd `agents/factory/ENGINE.md`). One
  OpenSpec change is one work order. The owner accepts its spec, then the factory engine runs it
  in its own git worktree, on its own branch: red (tests) -> green (code) -> review -> verify ->
  pull request. The engine commits, pushes and opens the pull request. It merges the pull request
  as the `gulasz101-factory` App when CI `check` is green and no never-path is touched.
- `main` takes pull requests only. Never push to `main`, never open a pull request yourself.
- Start of every stage:
  1. Stay in the worktree your prompt names. Never `git checkout` another branch.
  2. Read your stage prompt and the spec. They name the OpenSpec change, for example `web-compiles`.
  3. `scripts/openspec instructions apply --change <name> --json`: it lists the tasks and which are
     done. Read `openspec/changes/<name>/proposal.md`, `design.md` (if there is one) and `tasks.md`.
  4. Search Hindsight (bank `coding-agent::osiris`) and docs-mcp for what the work touches.
- Red writes tests only, under a `tests/` folder (`crates/<crate>/tests/`, `web/tests/`). The
  factory counts only those as tests: a `#[cfg(test)]` module inside `src/` is code, not a test.
- Green makes the change, ticks the tasks it finished in `tasks.md` (`- [ ]` -> `- [x]`), and runs
  `scripts/check.sh` until it ends with `CHECK OK`. Look up every library call in docs-mcp first
  (table below). Do not commit and do not push: the engine checks the worktree and commits.
- The last work order of a change also runs `scripts/openspec archive <name> -y`. The spec says so.
- If a task is wrong or impossible: do not invent another design. Say what is missing and why in
  your stage hand-in. The engine's stall ladder takes it from there.
- Never-paths (`.github/never-paths.json`): only the owner merges a change to them.

## Docs first (docs-mcp), then Firecrawl
**Rule: when you are not sure, look it up. Do not assume.** This is not only for new code. It is
also for errors you do not understand, a browser API (IndexedDB, File API, WebGPU, fetch), a build
or test failure, a wasm-bindgen or web-sys signature, or a tool flag. Each time:
1. `mcp__docs__search_docs` (or the `docs-search` skill) with the library from the table below.
2. Nothing useful? Use the `web-search` skill (our Firecrawl) with the exact error message.
3. Still nothing? Write in the issue comment what you looked up and that you are guessing.

Before you write code against a library, search it in docs-mcp. Use these versions: they are the
ones in `Cargo.lock`. Never guess an API from memory; these crates change between versions.
The hourly check counts your docs lookups. A run with code changes and zero lookups gets flagged.

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
- Same error three times: stop. Hand in with the exact error and what you tried. Do not commit.
- Learned something durable (a wasm gotcha, an API that differs from what you expected)? Retain it
  in Hindsight with `hindsight_ingest_document`.
