# web-build Specification

## Purpose
TBD - created by archiving change web-compiles. Update Purpose after archive.

## Requirements

### Requirement: Browser compile
The `osiris-app` crate SHALL compile for the `wasm32-unknown-unknown` target while the desktop build and its tests keep passing.

#### Scenario: wasm check passes
- GIVEN a clean checkout of `main`
- WHEN `cargo check --target wasm32-unknown-unknown -p osiris-app` runs
- THEN it exits 0

#### Scenario: desktop is unchanged
- GIVEN the same checkout
- WHEN `cargo test --workspace` runs
- THEN every test that passed before this change still passes

### Requirement: Gate script
The repo SHALL have `scripts/check.sh`, which fails on any branch other than `main`, on any tracked game file, on a failing native test, on a failing wasm compile, or on an invalid OpenSpec change, and prints `CHECK OK` only when all of them pass.

#### Scenario: game file tracked
- GIVEN a file `x.sg3` added to git
- WHEN `scripts/check.sh` runs
- THEN it exits non-zero before running the tests
