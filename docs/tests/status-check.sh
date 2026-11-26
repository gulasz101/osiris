#!/bin/sh
# The "Checks" section of docs/STATUS.md must say the truth about scripts/check.sh:
# it runs on any branch, because CI runs it on every pull request.
#
# Prints one line per acceptance criterion and exits 1 when one FAILs:
#     AC-1: FAIL section 4 still says 'runs the branch check'
#
# Usage: sh docs/tests/status-check.sh              check docs/STATUS.md
#        sh docs/tests/status-check.sh --self-test  check this script's matcher on fixtures
set -u

# Section 4 of a STATUS.md: from its heading to the next second level heading.
section4() {
	awk '
		/^##[[:space:]]+4\./ { inside = 1; next }
		inside && /^##[[:space:]]/ { exit }
		inside { print }
	' "$1"
}

# The bullets of section 4, each one joined onto a single line however it wraps.
bullets() {
	awk '
		/^##[[:space:]]+4\./ { inside = 1; next }
		inside && /^##[[:space:]]/ { exit }
		inside && /^- / { if (have) print buf; buf = $0; have = 1; next }
		inside && have && NF { buf = buf " " $0 }
		END { if (have) print buf }
	' "$1"
}

# Reads one STATUS.md, sets $fail to the problems found (empty when the wording is right).
fail=
check_doc() {
	fail=

	if [ ! -f "$1" ]; then
		fail="setup: $1 is missing"
		return 1
	fi

	# One line of text, so a sentence may wrap however the document likes.
	section=$(section4 "$1")
	flat=$(printf '%s\n' "$section" | tr '\n' ' ' | tr -s ' ' | sed 's/^ //; s/ $//')

	if [ -z "$flat" ]; then
		fail="setup: the document has no section 4"
		return 1
	fi

	lower=$(printf '%s' "$flat" | tr '[:upper:]' '[:lower:]')

	# The false claim is gone: check.sh is not "the branch check".
	case "$lower" in
	*"runs the branch check"*) add "section 4 still says 'runs the branch check'" ;;
	esac

	# It says check.sh runs on any branch, in one bullet that names the script.
	if ! printf '%s' "$lower" | grep -q "any branch"; then
		add "section 4 does not say 'any branch'"
	else
		line=$(bullets "$1" | grep -i "any branch" | grep -i "check\.sh" | head -n 1)
		[ -n "$line" ] || add "'any branch' is not said of scripts/check.sh"
	fi

	# And it says why: CI runs it on every pull request.
	if ! printf '%s' "$lower" | grep -q "pull request"; then
		add "section 4 does not mention a pull request"
	fi

	[ -z "$fail" ]
}

add() {
	if [ -z "$fail" ]; then
		fail=$1
	else
		fail="$fail; $1"
	fi
}

if [ "${1:-}" = "--self-test" ]; then
	tmp=$(mktemp -d) || {
		echo "status-check self-test: FAIL cannot make a temp folder"
		exit 1
	}
	trap 'rm -rf "$tmp"' EXIT

	# The wording the check must accept: check.sh runs on any branch, CI runs it
	# on every pull request. Lines wrap, as they do in the real document.
	mkdir -p "$tmp/good"
	cat > "$tmp/good/STATUS.md" <<'EOF'
## 3. Missing or different from desktop

- Text that is not section 4.

## 4. Checks

- `scripts/check.sh` runs on any branch: the code factory runs it in each work
  order's worktree, and CI runs it on every pull request
  (`.github/workflows/check.yml`), and ends with `CHECK OK`.
- `scripts/web-smoke.sh` builds the page and runs the browser smoke test.

## 5. Something else

- More text.
EOF

	# The old wording, which the check must reject.
	mkdir -p "$tmp/old"
	cat > "$tmp/old/STATUS.md" <<'EOF'
## 4. Checks

- `scripts/check.sh` runs the branch check, `scripts/no-game-files.sh`, `scripts/no-direct-fs.sh`,
  the `check-site.sh` self-test, `cargo test --workspace`, the wasm compile check and
  `scripts/openspec validate --all --strict`, and ends with `CHECK OK`.
EOF

	# "any branch" said of something other than scripts/check.sh, which the check
	# must also reject.
	mkdir -p "$tmp/noscript"
	cat > "$tmp/noscript/STATUS.md" <<'EOF'
## 4. Checks

- `cargo test --workspace` runs on any branch.
- CI runs `scripts/check.sh` on every pull request.
EOF

	check_doc "$tmp/good/STATUS.md" || {
		echo "status-check self-test: FAIL it rejected the fixed wording ($fail)"
		exit 1
	}
	check_doc "$tmp/old/STATUS.md" && {
		echo "status-check self-test: FAIL it accepted the old 'runs the branch check' wording"
		exit 1
	}
	check_doc "$tmp/noscript/STATUS.md" && {
		echo "status-check self-test: FAIL it accepted 'any branch' said of another command"
		exit 1
	}

	echo "status-check self-test: OK"
	exit 0
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
	echo "AC-1: FAIL setup: not inside a git worktree"
	exit 1
}

if check_doc "$root/docs/STATUS.md"; then
	echo "AC-1: PASS"
	exit 0
fi

echo "AC-1: FAIL $fail"
exit 1
