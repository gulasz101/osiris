//! The browser soak run's own arithmetic: how many frames a second the game drew, and
//! whether the wasm memory keeps growing month after month (web-soak).
//!
//! Only the browser build logs these lines, but the sums are plain code, so they build
//! (and are tested) on the desktop as well. Every function takes the moment or the byte
//! count it works with as an argument instead of reading a clock itself, which is what
//! lets the test below run over made-up times rather than waiting ten real seconds.

use std::path::Path;
use web_time::{Duration, Instant};

/// How often the soak reports its frame rate: every ten seconds of real time.
pub const FPS_EVERY: Duration = Duration::from_secs(10);

/// Months of growth in a row that count as a leak. One growing month means nothing (the
/// wasm memory grows in 64 KiB pages), so the rule waits for a whole year of them.
pub const GROWTH_RUN: usize = 12;

/// The frames drawn since the reporting window opened.
#[derive(Debug)]
pub struct Fps {
    frames: u32,
    since: Instant,
}

impl Fps {
    pub fn new(now: Instant) -> Self {
        Self { frames: 0, since: now }
    }

    /// Counts one frame drawn at `now`, and returns the frame rate of the window that
    /// just closed when `FPS_EVERY` has passed since it opened. A window that has not
    /// passed returns nothing and keeps counting.
    pub fn frame(&mut self, now: Instant) -> Option<f64> {
        self.frames += 1;
        let elapsed = now.saturating_duration_since(self.since);
        if elapsed < FPS_EVERY {
            return None;
        }
        let seconds = elapsed.as_secs_f64();
        let fps = if seconds > 0.0 { self.frames as f64 / seconds } else { 0.0 };
        self.frames = 0;
        self.since = now;
        Some(fps)
    }
}

/// The time one frame spent in each of the parts the browser build can see, in milliseconds.
///
/// `render` is the CPU time of building and submitting the frame, not the GPU's work: a
/// browser build cannot ask for GPU timings (`wgpu`'s timestamp queries are native only), and
/// the browser draws after the app returns. Whatever is left of the frame is [`FrameSplit`]'s
/// `other`.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Part {
    pub sim: f64,
    pub render: f64,
    pub io: f64,
}

impl Part {
    /// The three parts added up: the frame time this split explains.
    pub fn total(&self) -> f64 {
        self.sim + self.render + self.io
    }

    /// Adds `other`'s parts to this one's.
    fn add(&mut self, other: &Part) {
        self.sim += other.sim;
        self.render += other.render;
        self.io += other.io;
    }

    /// This part divided by `frames`, so a sum over a window reads as one frame.
    fn mean(&self, frames: f64) -> Part {
        Part { sim: self.sim / frames, render: self.render / frames, io: self.io / frames }
    }
}

/// Where a frame's time goes: the average of each part and of the whole frame over the same
/// ten seconds as [`Fps`], and the worst frame of the window (the one that spent most in its
/// three parts together).
///
/// The window is closed by the same rule as [`Fps`]: the frame at or past `FPS_EVERY` is the
/// one that reports, so the two lines always describe the same frames.
#[derive(Debug)]
pub struct FrameSplit {
    sums: Part,
    frames: u32,
    worst: Part,
    worst_total: f64,
    whole_ms: f64,
    since: Instant,
}

impl FrameSplit {
    pub fn new(now: Instant) -> Self {
        Self { sums: Part::default(), frames: 0, worst: Part::default(), worst_total: 0.0, whole_ms: 0.0, since: now }
    }

    /// Adds one frame, drawn `whole_ms` after the frame before it, and returns the window's
    /// (average, worst, average `other`) when `FPS_EVERY` has passed since it opened.
    ///
    /// `other` is the average frame length that is in none of the three parts: what the
    /// browser spent between frames, the software GPU among it.
    pub fn frame(&mut self, now: Instant, part: Part, whole_ms: f64) -> Option<(Part, Part, f64)> {
        self.sums.add(&part);
        self.whole_ms += whole_ms;
        self.frames += 1;
        if part.total() > self.worst_total {
            self.worst = part;
            self.worst_total = part.total();
        }
        let elapsed = now.saturating_duration_since(self.since);
        if elapsed < FPS_EVERY {
            return None;
        }
        let frames = self.frames as f64;
        let average = self.sums.mean(frames);
        let worst = self.worst;
        let other = self.whole_ms / frames - average.total();
        self.sums = Part::default();
        self.frames = 0;
        self.worst = Part::default();
        self.worst_total = 0.0;
        self.whole_ms = 0.0;
        self.since = now;
        Some((average, worst, other))
    }
}

/// The soak run's frame-split line, one decimal throughout:
/// `frame ms sim 1.2 render 130.4 io 0.3 other 35.1 (worst sim 9.0 render 210.0 io 4.0)`.
pub fn split_line(average: &Part, worst: &Part, other: f64) -> String {
    format!(
        "frame ms sim {:.1} render {:.1} io {:.1} other {:.1} (worst sim {:.1} render {:.1} io {:.1})",
        average.sim, average.render, average.io, other, worst.sim, worst.render, worst.io
    )
}

/// The months whose wasm memory was larger than the month before.
#[derive(Debug)]
pub struct Growth {
    last: u64,
    run: usize,
}

impl Growth {
    /// Starts the run at the memory the first month was measured at.
    pub fn new(bytes: u64) -> Self {
        Self { last: bytes, run: 0 }
    }

    /// Records one month's memory, and returns `true` when `GROWTH_RUN` months in a row
    /// have each been larger than the one before. A month that holds or gives back
    /// memory starts the run again at zero.
    pub fn month(&mut self, bytes: u64) -> bool {
        if bytes > self.last {
            self.run += 1;
        } else {
            self.run = 0;
        }
        self.last = bytes;
        self.run >= GROWTH_RUN
    }

    /// How many months in a row have grown, for the report.
    pub fn run(&self) -> usize {
        self.run
    }
}

/// The Mission Editor's state as JSON for the smoke test, which cannot read the editor's
/// fields from the page:
/// `{"name":"Small Oasis","dirty":true,"path":null,"status":"Saved ...","popup":"save-name",
/// "tool":"paint"}`.
pub fn editor_json(name: &str, dirty: bool, path: Option<&Path>, status: Option<&str>, popup: &str, tool: &str) -> String {
    let path = match path {
        Some(p) => format!("\"{}\"", json_text(&p.to_string_lossy())),
        None => "null".to_owned(),
    };
    let status = match status {
        Some(s) => format!("\"{}\"", json_text(s)),
        None => "null".to_owned(),
    };
    format!(
        "{{\"name\":\"{}\",\"dirty\":{dirty},\"path\":{path},\"status\":{status},\"popup\":\"{}\",\"tool\":\"{}\"}}",
        json_text(name),
        json_text(popup),
        json_text(tool)
    )
}

/// The city's state as JSON, so the smoke test can see why an Escape did not ask "Leave the
/// Kingdom?": `{"idle":true,"lost":false,"paused":false,"messages":0,"dialog":false,
/// "confirm":false,"custom":false,"tool":"none","cursor":"arrow"}`.
pub fn city_json(state: (bool, bool, bool, usize, bool, bool, bool), tool: &str, cursor: &str) -> String {
    let (idle, lost, paused, messages, dialog, confirm, custom) = state;
    format!(
        "{{\"idle\":{idle},\"lost\":{lost},\"paused\":{paused},\"messages\":{messages},\"dialog\":{dialog},\"confirm\":{confirm},\"custom\":{custom},\"tool\":\"{}\",\"cursor\":\"{}\"}}",
        json_text(tool),
        json_text(cursor)
    )
}

/// `s` as the inside of a JSON string.
fn json_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fps_counts_the_frames_of_the_window() {
        let start = Instant::now();
        let mut fps = Fps::new(start);
        // A hundred frames over ten seconds of made-up time is ten a second.
        let mut rate = None;
        for i in 0..=100 {
            rate = fps.frame(start + Duration::from_millis(i * 100));
        }
        // 101 frames over ten seconds, the last one included in the window it closes.
        let rate = rate.expect("the window closed at ten seconds");
        assert!((rate - 10.1).abs() < 0.01, "got {rate}");
    }

    #[test]
    fn fps_says_nothing_before_the_window_closes() {
        let start = Instant::now();
        let mut fps = Fps::new(start);
        for i in 0..99 {
            assert_eq!(fps.frame(start + Duration::from_millis(i * 100)), None, "frame {i}");
        }
        // The hundredth frame is the first one at or past ten seconds.
        assert!(fps.frame(start + Duration::from_secs(10)).is_some());
    }

    #[test]
    fn fps_starts_a_new_window_after_a_report() {
        let start = Instant::now();
        let mut fps = Fps::new(start);
        for i in 0..60 {
            assert_eq!(fps.frame(start + Duration::from_millis(i * 1000 / 6)), None);
        }
        assert!(fps.frame(start + Duration::from_secs(10)).is_some());
        // The next window holds two frames in ten more seconds: two a second.
        assert_eq!(fps.frame(start + Duration::from_secs(11)), None);
        assert_eq!(fps.frame(start + Duration::from_secs(20)), Some(0.2));
    }

    #[test]
    fn frame_split_averages_one_window_and_keeps_its_worst_frame() {
        let start = Instant::now();
        let mut split = FrameSplit::new(start);
        // Three frames in ten seconds: sim 1, 2 and 3 ms, render 100 each, io 1 each, and
        // whole frames of 200 ms each. The third is the worst of them.
        let parts = [Part { sim: 1.0, render: 100.0, io: 1.0 }, Part { sim: 2.0, render: 100.0, io: 1.0 }, Part { sim: 3.0, render: 100.0, io: 1.0 }];
        assert_eq!(split.frame(start + Duration::from_secs(1), parts[0], 200.0), None);
        assert_eq!(split.frame(start + Duration::from_secs(2), parts[1], 200.0), None);
        let (average, worst, other) = split.frame(start + Duration::from_secs(10), parts[2], 200.0).expect("the window closed at ten seconds");
        // Averages: sim (1+2+3)/3, render 100, io 1. Other: a 200 ms frame with 103 in its parts.
        assert!((average.sim - 2.0).abs() < 1e-9, "sim {}", average.sim);
        assert!((average.render - 100.0).abs() < 1e-9, "render {}", average.render);
        assert!((average.io - 1.0).abs() < 1e-9, "io {}", average.io);
        assert!((other - 97.0).abs() < 1e-9, "other {other}");
        assert_eq!(worst, parts[2], "the third frame spent the most in its parts");
    }

    #[test]
    fn frame_split_starts_a_new_window_after_a_report() {
        let start = Instant::now();
        let mut split = FrameSplit::new(start);
        let part = Part { sim: 5.0, render: 50.0, io: 0.0 };
        assert_eq!(split.frame(start + Duration::from_secs(5), part, 100.0), None);
        assert!(split.frame(start + Duration::from_secs(10), part, 100.0).is_some());
        // The next window holds one frame of its own, so its worst is that frame and not
        // the 50 ms render of the window before it.
        let part = Part { sim: 7.0, render: 2.0, io: 0.0 };
        let (average, worst, other) = split.frame(start + Duration::from_secs(20), part, 400.0).expect("the second window closed");
        assert!((average.sim - 7.0).abs() < 1e-9, "sim {}", average.sim);
        assert_eq!(worst, part, "the only frame of the window is its worst");
        assert!((other - 391.0).abs() < 1e-9, "other {other}");
    }

    #[test]
    fn split_line_names_every_part_to_one_decimal() {
        let average = Part { sim: 1.25, render: 130.44, io: 0.34 };
        let worst = Part { sim: 9.0, render: 210.0, io: 4.0 };
        assert_eq!(
            split_line(&average, &worst, 42.06),
            "frame ms sim 1.2 render 130.4 io 0.3 other 42.1 (worst sim 9.0 render 210.0 io 4.0)"
        );
    }

    #[test]
    fn growth_needs_twelve_months_in_a_row() {
        let mut growth = Growth::new(1_000_000);
        for month in 1..GROWTH_RUN {
            assert!(!growth.month(1_000_000 + 65_536 * month as u64), "month {month}");
            assert_eq!(growth.run(), month);
        }
        assert!(growth.month(1_000_000 + 65_536 * GROWTH_RUN as u64), "the twelfth month");
    }

    #[test]
    fn growth_starts_again_when_a_month_holds() {
        let mut growth = Growth::new(1_000_000);
        for month in 1..=5 {
            assert!(!growth.month(1_000_000 + 65_536 * month));
        }
        // A month that gives memory back clears the run, so eleven later months pass.
        assert!(!growth.month(900_000));
        assert_eq!(growth.run(), 0);
        let mut last = 900_000;
        for month in 1..GROWTH_RUN {
            last += 65_536;
            assert!(!growth.month(last), "month {month}");
        }
        assert!(growth.month(last + 65_536));
    }

    #[test]
    fn editor_json_reports_the_editor_state() {
        // Nothing picked yet: no path, no message, and the tool's own name.
        assert_eq!(
            editor_json("Small Oasis", false, None, None, "", "none"),
            r#"{"name":"Small Oasis","dirty":false,"path":null,"status":null,"popup":"","tool":"none"}"#
        );
    }

    #[test]
    fn city_json_reports_what_holds_the_city() {
        // A city with one message open is not idle, and the line says so.
        assert_eq!(
            city_json((false, false, false, 1, false, false, false), "none", "arrow"),
            r#"{"idle":false,"lost":false,"paused":false,"messages":1,"dialog":false,"confirm":false,"custom":false,"tool":"none","cursor":"arrow"}"#
        );
    }

    #[test]
    fn editor_json_quotes_a_saved_path_and_a_message() {
        // A quote or a backslash in a name must not break the JSON the test parses, and a
        // saved path is a string, not `null`.
        let path = Path::new(r#"/user/maps/Soak "Edit".map"#);
        let json = editor_json("Soak \"Edit\"", true, Some(path), Some("Saved /user/maps/Soak \"Edit\".map"), "save-name", "paint");
        assert_eq!(
            json,
            r#"{"name":"Soak \"Edit\"","dirty":true,"path":"/user/maps/Soak \"Edit\".map","status":"Saved /user/maps/Soak \"Edit\".map","popup":"save-name","tool":"paint"}"#
        );
    }
}
