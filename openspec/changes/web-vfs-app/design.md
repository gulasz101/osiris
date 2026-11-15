# Design: web-vfs-app

The API is in `crates/osiris-vfs/src/lib.rs` (from `web-vfs-core`). The replacement rules are the
same as in that change:

- `std::fs::read / read_to_string / write / create_dir_all / rename / remove_*` ->
  the `osiris_vfs::` function with the same name.
- `path.is_dir()` / `.is_file()` / `.exists()` -> `osiris_vfs::is_dir(path)` / ...
- `std::fs::metadata(p).and_then(|m| m.modified())` -> `osiris_vfs::modified(p)`
- `std::fs::metadata(p).map_or(0, |m| m.len())` -> `osiris_vfs::len(p).unwrap_or(0)`
- `std::fs::read_dir(d).ok()?.flatten().map(|e| e.path())` ->
  `osiris_vfs::read_dir(d).ok()?.into_iter().map(|e| e.path())`

Two special cases:
- `gfx.rs:~318` writes the screenshot PNG with `std::fs::File::create`. Encode into a
  `Vec<u8>` instead (`png::Encoder::new(&mut bytes, w, h)`; check the `png` 0.18 encoder in
  docs-mcp or the existing code above), drop the encoder/writer so it finishes, then
  `osiris_vfs::write(out, bytes)?`.
- `movie.rs:~88` already names `osiris_vfs::Reader` after `web-vfs-core` task 2.4. If not, do it
  here.

Run `scripts/no-direct-fs.sh crates/osiris-app/src | grep -v main.rs` after each file to see what
is left.
