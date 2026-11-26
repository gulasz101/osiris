//! Trade is closed per mission, as in the original game: the tutorial missions 0-4
//! (Nubt, Thinis, Perwadjyt, Nekhen, Mennefer) start with the Kingdom's trade closed
//! and open it only on the beat the mission says (Mennefer's 100 papyrus unlock),
//! while Timna (5) and custom scenarios trade from the first day. The Kingdom map
//! itself still opens while trade is closed, and says why.
//!
//! The contract these tests pin, for the change `sim-trade-availability`:
//!
//! - `World::trade_closed_reason(&self)` returns `None` while the mission trades and
//!   `Some(reason)` with a non-empty, player-facing reason while it does not. (Either
//!   `Option<String>` or `Option<&'static str>` satisfies these tests.)
//! - `World::open_trade_route(city)` returns an error with a non-empty reason and
//!   changes nothing (no route opened, no debens spent) while trade is closed.
//! - a mission unlock in `mission.unlocks` may carry `opens_trade`, and meeting it
//!   opens trade; Mennefer's 100-papyrus unlock is the one that carries it.
//!
//! The tests build a synthetic 40x40 world from `Defs::default()`, `Balance::default()`
//! and a blank `Scenario`, so they need no game data and give the same result on the
//! Mac and in CI.

use osiris_formats::Scenario;
use osiris_formats::chunks::GRID_TILES;
use osiris_formats::empire::{city, object};
use osiris_sim::missions::Condition;
use osiris_sim::trade::{MapObject, RESOURCES, TradeCity, TradeRoute};
use osiris_sim::{Balance, Defs, World};
use std::sync::Arc;

/// A flat 40x40 map of bare land with 10 000 deben and every disaster switched off,
/// as the other synthetic-world tests here build.
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
    world.treasury = 10_000;
    world
}

/// Papyrus in the resources table (`trade::RECOMMENDED_GOODS` and the model both put
/// it at 23); used only to give the fixture city a good it really sells.
const PAPYRUS: u16 = 23;
/// What the fixture's trade route charges to open.
const ROUTE_COST: i32 = 300;

/// A world with a Kingdom to trade with: one land route to a foreign city that sells
/// papyrus and is not open yet, its icon on the map, and a second city of ours, so a
/// closed mission has something to draw on the Kingdom map and something to refuse.
fn kingdom_world() -> World {
    let mut world = flat_world();
    let mut limit = vec![0; RESOURCES];
    limit[PAPYRUS as usize] = 1500;
    world.trade.routes.push(TradeRoute {
        points: vec![(0, 0), (800, 0)],
        step: 5,
        sea: false,
        limit,
        traded: vec![0; RESOURCES],
    });
    let mut sells = vec![false; RESOURCES];
    sells[PAPYRUS as usize] = true;
    world.trade.cities.push(TradeCity {
        name_id: 38,
        city_type: city::FOREIGN_TRADING,
        route: 0,
        open: false,
        cost: ROUTE_COST,
        sea: false,
        sells: sells.clone(),
        buys: vec![false; RESOURCES],
        listed_sells: sells,
        listed_buys: vec![false; RESOURCES],
        pos: (10, 8),
        ..Default::default()
    });
    world.trade.cities.push(TradeCity {
        name_id: 1,
        city_type: city::OURS,
        route: 0,
        open: true,
        pos: (20, 20),
        ..Default::default()
    });
    world.trade.map_objects.push(MapObject { kind: object::CITY, x: 20, y: 20, picture: 0, name: 1 });
    world.trade.map_objects.push(MapObject { kind: object::CITY, x: 10, y: 8, picture: 0, name: 38 });
    world
}

/// `World::trade_closed_reason` as a string: `None` while the mission trades.
fn closed_reason(world: &World) -> Option<String> {
    world.trade_closed_reason().map(|r| r.to_string())
}

/// The mission data as the file holds it, so the tests can check a field the loader
/// does not have to expose (only `id`, `unlocks[].when` and `unlocks[].opens_trade`).
#[derive(serde::Deserialize)]
struct RawFile {
    mission: Vec<RawMission>,
}

#[derive(serde::Deserialize)]
struct RawMission {
    id: i32,
    #[serde(default)]
    unlocks: Vec<RawUnlock>,
}

#[derive(serde::Deserialize)]
struct RawUnlock {
    when: String,
    #[serde(default)]
    opens_trade: bool,
}

fn raw_missions() -> Vec<RawMission> {
    let text = include_str!("../data/missions.toml");
    toml::from_str::<RawFile>(text).expect("missions.toml parses").mission
}

/// The index of the unlock in mission `id` whose condition mentions `word`, in the
/// order the mission's unlocks are loaded.
fn unlock_index(id: i32, word: &str) -> usize {
    let missions = raw_missions();
    let m = missions.iter().find(|m| m.id == id).unwrap_or_else(|| panic!("mission {id} in missions.toml"));
    m.unlocks.iter().position(|u| u.when.contains(word)).unwrap_or_else(|| panic!("mission {id} has no unlock mentioning {word}"))
}

/// Missions 0-4 are the tutorials, and the original keeps the Kingdom's trade closed
/// in all of them until the mission's own beat opens it.
#[test]
fn campaign_missions_zero_to_four_start_with_trade_closed() {
    for id in 0..=4 {
        let mut world = kingdom_world();
        world.load_mission(id);

        let reason = closed_reason(&world);
        assert!(
            reason.as_deref().is_some_and(|r| !r.trim().is_empty()),
            "mission {id}: trade_closed_reason must explain the closed state, got {reason:?}"
        );

        let treasury = world.treasury;
        let refused = world.open_trade_route(0).err();
        assert!(
            refused.is_some_and(|r| !r.trim().is_empty()),
            "mission {id}: opening a trade route must be refused with a reason, got {refused:?}"
        );
        assert!(!world.trade.cities[0].open, "mission {id}: a refused route must stay closed");
        assert_eq!(world.treasury, treasury, "mission {id}: a refused route must not cost debens");
    }
}

/// The Kingdom map still opens in a closed mission: the cities, routes and map
/// objects the scenario brought are all still there for the window to draw, and only
/// the trade status says why nothing can be opened.
#[test]
fn a_closed_mission_keeps_its_kingdom_map() {
    let mut world = kingdom_world();
    let (cities, routes, objects) = (world.trade.cities.len(), world.trade.routes.len(), world.trade.map_objects.len());
    world.load_mission(0);

    assert!(closed_reason(&world).is_some(), "mission 0 starts with trade closed");
    assert_eq!(world.trade.cities.len(), cities, "the Kingdom's cities must survive the mission load");
    assert_eq!(world.trade.routes.len(), routes, "the Kingdom's routes must survive the mission load");
    assert_eq!(world.trade.map_objects.len(), objects, "the Kingdom map's objects must survive the mission load");
    assert!(world.trade.cities[0].trades(), "the closed city is still a trading city, so the window can say why not");
}

/// Timna (mission 5) is the first campaign mission that trades, and a custom scenario
/// (no campaign mission at all) trades from the start.
#[test]
fn timna_and_custom_scenarios_trade() {
    let mut world = kingdom_world();
    world.load_mission(5);
    let reason = closed_reason(&world);
    assert!(reason.is_none(), "Timna trades, so there must be no closed reason, got {reason:?}");
    let opened = world.open_trade_route(0);
    assert!(opened.is_ok(), "Timna's trade route opens, got {opened:?}");
    assert!(world.trade.cities[0].open, "Timna's route is open");
    assert_eq!(world.treasury, 10_000 - ROUTE_COST, "the opened route costs its price");

    let mut custom = kingdom_world();
    assert!(custom.mission.is_none(), "a custom scenario loads no campaign mission");
    let reason = closed_reason(&custom);
    assert!(reason.is_none(), "a custom scenario trades, so there is no closed reason, got {reason:?}");
    let opened = custom.open_trade_route(0);
    assert!(opened.is_ok(), "a custom scenario's trade route opens, got {opened:?}");
    assert!(custom.trade.cities[0].open, "a custom scenario's route is open");
}

/// Mennefer's 100-papyrus unlock is the beat that opens the Kingdom, so it carries
/// `opens_trade`; the earlier tutorials' unlocks never do, since their trade never
/// opens at all.
#[test]
fn mennefers_papyrus_unlock_carries_opens_trade() {
    let missions = raw_missions();
    let mennefer = missions.iter().find(|m| m.id == 4).expect("Mennefer is mission 4 in missions.toml");
    let papyrus = mennefer
        .unlocks
        .iter()
        .find(|u| u.when.contains("papyrus"))
        .expect("Mennefer has a papyrus unlock");
    assert!(papyrus.when.contains("100"), "this is the 100-papyrus unlock, got {:?}", papyrus.when);
    assert!(papyrus.opens_trade, "Mennefer's 100-papyrus unlock carries opens_trade");

    for id in 0..=3 {
        let m = missions.iter().find(|m| m.id == id).unwrap_or_else(|| panic!("mission {id} in missions.toml"));
        assert!(
            !m.unlocks.iter().any(|u| u.opens_trade),
            "mission {id} never opens trade, so none of its unlocks carries opens_trade"
        );
    }
}

/// Meeting Mennefer's 100-papyrus unlock opens the Kingdom: the closed reason goes
/// away and the trade routes can be opened from then on.
#[test]
fn mennefers_papyrus_unlock_opens_trade_when_it_fires() {
    let index = unlock_index(4, "papyrus");
    let mut world = kingdom_world();
    world.load_mission(4);
    assert!(closed_reason(&world).is_some(), "Mennefer starts with trade closed");

    // Meet the unlock: the beat itself is a stored-papyrus count the synthetic world
    // has no resource ids for, so the test fires it as the mission's start condition
    // and lets the day's first tick run the tutorial checks.
    let unlocks = &mut world.mission.as_mut().expect("mission 4 is loaded").unlocks;
    unlocks[index].when = Condition::Start;
    world.tick();

    assert!(
        world.mission.as_ref().is_some_and(|m| m.unlocks[index].done),
        "the papyrus unlock is fired"
    );
    let reason = closed_reason(&world);
    assert!(reason.is_none(), "the papyrus unlock opens trade, so the closed reason is gone, got {reason:?}");
    let opened = world.open_trade_route(0);
    assert!(opened.is_ok(), "a trade route opens once the papyrus unlock has fired, got {opened:?}");
    assert!(world.trade.cities[0].open, "the route is open after the unlock");
}
