# Tasks: web-status

- [ ] 1.1 Archive the finished changes still in `openspec/changes/` (web-pages, web-mission, web-movies when complete) with `scripts/openspec archive <name> -y`. Check: `scripts/openspec list` shows only web-status.
- [ ] 1.2 Write `docs/STATUS.md` section 1 "Run it" (proposal). Run every command in it yourself on a clean shell. Check: paste the commands and their last output line in the issue comment.
- [ ] 1.3 Section 2 "Works": one line per archived web-* change, each with its smoke command. Check: run each smoke command once (with `OSIRIS_DATA=/Users/paperclip/PharaohData/Akhenaten/resources` where needed) and paste its pass line; a line whose command fails moves to section 3.
- [ ] 1.4 Sections 3 "Missing or different from desktop" and 4 "Checks". Check: `grep -c '^## ' docs/STATUS.md` prints 4.
- [ ] 1.5 README links to `docs/STATUS.md`. Check: `scripts/check.sh` ends with `CHECK OK` and `scripts/no-game-files.sh` prints OK.
