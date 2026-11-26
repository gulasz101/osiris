//! Clear Land must leave a burning ruin standing: the original's clear tool skips a
//! burning ruin, so it is neither demolished nor counted in the cost, while an
//! ordinary building in the same rectangle still goes (fire bug B, GUL-2270).
//!
//! The tests build a synthetic 40x40 world from `Defs::default()`, `Balance::default()`
//! and a blank `Scenario`, so they need no game data and give the same result on the
//! Mac and in CI.

use osiris_formats::Scenario;
use osiris_formats::chunks::GRID_TILES;
use osiris_sim::buildings::{self, kind};
use osiris_sim::map::terrain;
use osiris_sim::{Balance, Command, Defs, Outcome, World};
use std::sync::Arc;

/// A flat 40x40 map of bare land (terrain 0) with 10 000 deben and every disaster
/// switched off, so the only change in a test is the one the test makes itself.
fn flat_world() -> World {
    let mut scenario = Scenario::default();
    scenario.info.width = 40;
    scenario.info.height = 40;
    scenario.info.initial_funds = 10_000;
    scenario.images = vec![0; GRID_TILES];
    scenario.edges = vec![0; GRID_TILES];
    scenario.terrain = vec![0; GRID_TILES];
    scenario.bitfields = vec![0; GRID_TILES];
    scenario.random = vec![0; GRID_TILES];
    scenario.elevation = vec![0; GRID_TILES];
    scenario.soil_fertility = vec![0; GRID_TILES];
    scenario.vegetation_growth = vec![0; GRID_TILES];
    scenario.moisture = vec![0; GRID_TILES];

    let mut world = World::new(&scenario, Arc::new(Defs::default()), Arc::new(Balance::default()));
    world.start(&scenario);
    world.rules.fire = false;
    world.rules.collapse = false;
    world.rules.disasters = false;
    world.rules.floods = false;
    world.rules.disease = false;
    world
}

/// A burning ruin standing on `(x, y)`. `create_building` leaves a new building
/// unstarted, and a fire's ruin is a building already alight, so it gets some progress.
fn burning_ruin(world: &mut World, x: i32, y: i32) -> buildings::BuildingId {
    let id = world.create_building(kind::BURNING_RUIN, x, y);
    if let Some(b) = world.buildings.get_mut(id) {
        b.progress = 1;
    }
    id
}

/// Clear Land over a rectangle holding a burning ruin and an ordinary building: the
/// ruin survives and costs nothing, the ordinary building comes down.
#[test]
fn clear_land_leaves_a_burning_ruin() {
    let mut world = flat_world();
    let ruin = burning_ruin(&mut world, 12, 12);
    let ordinary = world.create_building(kind::WELL, 14, 12);

    let outcome = world.apply(&Command::Clear { x0: 12, y0: 12, x1: 14, y1: 12 });
    match outcome {
        Outcome::Done { items, .. } => assert_eq!(items, 1, "Clear Land counted the burning ruin as well as the ordinary building"),
        other => panic!("Clear Land over a burning ruin did not run: {other:?}"),
    }
    assert_eq!(world.buildings.get(ruin).map(|b| b.kind), Some(kind::BURNING_RUIN), "Clear Land demolished the burning ruin");
    assert_eq!(world.map.building.at_or(12, 12, 0), ruin, "the burning ruin's tile no longer belongs to it");
    assert_eq!(world.map.terrain.at_or(12, 12, 0) & terrain::BUILDING, terrain::BUILDING, "the burning ruin's tile is no longer built on");
    assert!(world.buildings.get(ordinary).is_none(), "the ordinary building in the same rectangle is still standing");
    assert_eq!(world.map.terrain.at_or(14, 12, 0) & terrain::BUILDING, 0, "the ordinary building's tile is still built on");
}

/// `World::can_clear` is the rule behind Clear Land and its cost preview: it refuses
/// a burning ruin and accepts everything else.
#[test]
fn can_clear_refuses_a_burning_ruin() {
    let mut world = flat_world();
    burning_ruin(&mut world, 12, 12);
    world.create_building(kind::WELL, 14, 12);

    assert!(!world.can_clear(12, 12), "can_clear accepts a burning ruin");
    assert!(world.can_clear(14, 12), "can_clear refuses an ordinary building");
    assert!(world.can_clear(20, 20), "can_clear refuses empty land");
}
