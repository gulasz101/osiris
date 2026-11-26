//! Fire fighting: a fireman roaming near a burning ruin walks to it and puts it out,
//! a ruin further than 25 tiles away keeps burning, and two firemen never jam on one
//! fire.
//!
//! The city is laid out here rather than read from the game: a flat 80x80 grid of road
//! with a firehouse on it, the firemen and the burning ruins placed by hand. Running
//! needs no game data at all, so the tests report the same thing on any machine.
//!
//! Each failing check prints the line the factory reads, `AC-1: FAIL <why>`, before it
//! panics; `fire-fighting-check.sh` turns that into the acceptance criterion's report.

use osiris_formats::chunks::GRID_TILES;
use osiris_formats::Scenario;
use osiris_sim::buildings::{BuildingId, kind};
use osiris_sim::figures::Travel;
use osiris_sim::map::terrain;
use osiris_sim::services::figure_kind::FIREMAN;
use osiris_sim::time::TICKS_PER_DAY;
use osiris_sim::{Balance, Defs, World};
use std::sync::Arc;

const WIDTH: i32 = 80;
const HEIGHT: i32 = 80;
/// The state a roamer walks its rounds in. `services::action` is private to the crate,
/// whose constant `ROAMING` this is.
const ROAMING: u16 = 1;
/// Days a fire may burn before firemen must have put it out.
const DAYS: usize = 8;

/// Prints the acceptance criterion's failing line, then fails the test.
fn fail(ac: &str, why: &str) -> ! {
    println!("{ac}: FAIL {why}");
    panic!("{ac}: {why}");
}

/// A flat city of open road, with a firehouse at (40, 10). The tests add the ruins
/// and the firemen they need.
fn city() -> World {
    let mut scenario = Scenario::default();
    scenario.info.width = WIDTH;
    scenario.info.height = HEIGHT;
    scenario.info.start_offset = 0;
    scenario.info.start_year = -3000;
    scenario.info.initial_funds = 1_000_000;
    scenario.terrain = vec![terrain::ROAD; GRID_TILES];
    scenario.images = vec![0; GRID_TILES];
    scenario.edges = vec![0; GRID_TILES];
    scenario.bitfields = vec![0; GRID_TILES];
    scenario.random = vec![0; GRID_TILES];
    scenario.elevation = vec![0; GRID_TILES];
    scenario.soil_fertility = vec![0; GRID_TILES];
    scenario.vegetation_growth = vec![0; GRID_TILES];
    scenario.moisture = vec![0; GRID_TILES];
    let mut world = World::new(&scenario, Arc::new(Defs::default()), Arc::new(Balance::default()));
    world.start(&scenario);
    world.rules.fire = true;
    let firehouse = world.create_building(kind::FIREHOUSE, 40, 10);
    if let Some(b) = world.buildings.get_mut(firehouse) {
        b.workers = 3;
    }
    world
}

fn firehouse(world: &World) -> BuildingId {
    world.map.building.at_or(40, 10, 0)
}

/// A burning ruin a few days old, as a fire leaves behind.
fn burning_ruin(world: &mut World, x: i32, y: i32) -> BuildingId {
    let id = world.create_building(kind::BURNING_RUIN, x, y);
    if let Some(ruin) = world.buildings.get_mut(id) {
        ruin.progress = 3;
    }
    id
}

/// Still burning at `(x, y)`?
fn still_burning(world: &World, x: i32, y: i32, id: BuildingId) -> bool {
    world.map.building.at_or(x, y, 0) == id && world.buildings.get(id).is_some_and(|b| b.kind == kind::BURNING_RUIN)
}

/// A fireman on his rounds, belonging to the firehouse.
fn fireman(world: &mut World, x: i32, y: i32) -> u32 {
    let home = firehouse(world);
    let id = world.figures.spawn(FIREMAN, x, y, Travel::Roads);
    if let Some(f) = world.figures.get_mut(id) {
        f.home = home;
        f.action = ROAMING;
        f.roam_left = 100_000;
    }
    id
}

/// Ticks `days` game days one tick at a time.
fn run_days(world: &mut World, days: usize) {
    for _ in 0..days * TICKS_PER_DAY as usize {
        world.tick();
    }
}

/// AC-1: a fireman near a burning ruin walks to it and puts it out within eight days.
#[test]
fn fireman_puts_out_a_burning_ruin_within_eight_days() {
    let mut world = city();
    fireman(&mut world, 42, 10);
    // Twelve tiles from the firehouse, fourteen from the fireman: well inside reach.
    let ruin = burning_ruin(&mut world, 40, 24);
    for _ in 0..DAYS {
        run_days(&mut world, 1);
        if !still_burning(&world, 40, 24, ruin) {
            return;
        }
    }
    fail("AC-1", &format!("the ruin 14 tiles from the fireman was still burning after {DAYS} days"));
}

/// AC-2: a ruin more than 25 tiles away keeps burning even while the same fireman is
/// putting out one near him.
#[test]
fn a_ruin_more_than_25_tiles_away_keeps_burning() {
    let mut world = city();
    fireman(&mut world, 42, 10);
    // Fourteen tiles off: the fireman can reach it, so a fireman who went after fires
    // at any distance would reach the far one too.
    let near = burning_ruin(&mut world, 40, 24);
    // Just past the reach: twenty-six tiles from the fireman and from his firehouse,
    // close enough that a fireman sent after fires at any distance would get to it in
    // the eight days.
    let far = burning_ruin(&mut world, 40, 36);
    run_days(&mut world, DAYS);
    if still_burning(&world, 40, 24, near) {
        fail("AC-2", &format!("the fireman did not put out the ruin 14 tiles away in {DAYS} days"));
    }
    if !still_burning(&world, 40, 36, far) {
        fail("AC-2", "the ruin 26 tiles away went out, beyond the fireman's 25-tile reach");
    }
}

/// AC-2: two firemen sent to one fire put it out and go back to their rounds, neither
/// left standing stuck on the ashes.
#[test]
fn two_firemen_do_not_get_stuck_on_one_fire() {
    let mut world = city();
    let a = fireman(&mut world, 42, 10);
    let b = fireman(&mut world, 43, 10);
    let ruin = burning_ruin(&mut world, 40, 24);
    let mut out_after = None;
    for day in 1..=DAYS {
        run_days(&mut world, 1);
        if !still_burning(&world, 40, 24, ruin) {
            out_after = Some(day);
            break;
        }
    }
    let Some(day) = out_after else {
        fail("AC-2", &format!("two firemen left the ruin 14 tiles away burning after {DAYS} days"));
    };
    // Once the fire is out they go back to their rounds: a day later no fireman is
    // left standing where he was, or standing on the ashes.
    let start: Vec<(i32, i32)> = [a, b]
        .iter()
        .filter_map(|&id| world.figures.get(id).map(|f| (f.x, f.y)))
        .collect();
    if start.len() != 2 {
        fail("AC-2", &format!("a fireman vanished before the fire was put out on day {day}"));
    }
    run_days(&mut world, 1);
    let mut stuck = Vec::new();
    for (i, &id) in [a, b].iter().enumerate() {
        // A fireman who has finished his round and gone home is not stuck on the fire.
        let Some(f) = world.figures.get(id).filter(|f| !f.dead) else { continue };
        if (f.x, f.y) == start[i] {
            stuck.push(format!("fireman {} still stands at {},{} a day after the fire went out", i + 1, f.x, f.y));
        }
        if (f.x, f.y) == (40, 24) {
            stuck.push(format!("fireman {} stands on the burnt ruins", i + 1));
        }
    }
    if !stuck.is_empty() {
        fail("AC-2", &stuck.join("; "));
    }
}

