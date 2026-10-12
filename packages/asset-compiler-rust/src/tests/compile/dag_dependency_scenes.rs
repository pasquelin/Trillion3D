//! The dependency lists of real cooks: a grid, the engine's test scenes, a family of generated
//! scenes of thin closed parts and an open-world cell. Each holds the published bound, closes its
//! lists and reaches the root cover.
use super::cooked_scene::{cook_fixture, cook_scene, CookedScene, ENGINE_SCENES};
use super::*;
use crate::tests::thin_shapes::ThinShapes;

/// Every bundle's closed list, as the report publishes it.
fn published_lists(streams: &Value) -> Vec<Vec<usize>> {
    streams["pages"]
        .as_array()
        .expect("bundles")
        .iter()
        .map(|bundle| {
            let list = bundle["dependencies"].as_array().expect("dependencies");
            list.iter()
                .map(|d| d.as_u64().expect("index") as usize)
                .collect()
        })
        .collect()
}

/// Checks a cooked primitive's dependency lists against its structure: the published bound is the
/// most parents of one cluster and holds for every bundle's own parent bundles, every list is
/// closed and reaches the root cover, and every cluster's parents sit on its bundle's list.
/// Returns how many bundles lie past the root cover.
fn assert_dependencies_hold(primitive: &Value) -> usize {
    let pages = primitive["pages"].as_array().expect("pages");
    let streams = &primitive["streams"];
    let groups = primitive["structure"]["groups"].as_array().expect("groups");
    let pinned = streams["pinned"].as_u64().expect("pinned") as usize;
    let bound = streams["dependencyBound"].as_u64().expect("bound") as usize;
    let lists = published_lists(streams);
    let outputs = |page: &Value| -> Vec<usize> {
        page["group"].as_u64().map_or(vec![], |group| {
            let outputs = groups[group as usize]["outputs"]
                .as_array()
                .expect("outputs");
            outputs
                .iter()
                .map(|id| id.as_u64().expect("id") as usize)
                .collect()
        })
    };
    assert_eq!(
        pages.iter().map(|page| outputs(page).len()).max(),
        Some(bound),
        "the bound is the most parents of one cluster, known before packing"
    );
    assert_eq!(
        lists.iter().map(Vec::len).max(),
        streams["maxDependencies"].as_u64().map(|max| max as usize),
        "the longest closed list is published"
    );
    let mut direct: Vec<Vec<usize>> = vec![Vec::new(); lists.len()];
    for page in pages {
        let own = page["stream"].as_u64().expect("stream") as usize;
        for parent in outputs(page) {
            let holder = pages[parent]["stream"].as_u64().expect("stream") as usize;
            assert!(lists[own].contains(&holder), "bundle {own} lists {holder}");
            direct[own].push(holder);
        }
    }
    for (bundle, list) in lists.iter().enumerate() {
        direct[bundle].sort_unstable();
        direct[bundle].dedup();
        assert!(
            direct[bundle].len() <= bound,
            "bundle {bundle} needs {} parent bundles, over {bound}",
            direct[bundle].len()
        );
        assert_eq!(
            bundle < pinned,
            list.is_empty(),
            "only the root cover depends on nothing"
        );
        if bundle >= pinned {
            assert!(
                list.iter().any(|&d| d < pinned),
                "bundle {bundle} reaches the root cover"
            );
        }
        for &dependency in list {
            assert!(
                lists[dependency].iter().all(|d| list.contains(d)),
                "{bundle} is closed"
            );
        }
    }
    lists.len() - pinned
}

#[test]
fn every_bundle_lists_a_closure_that_reaches_the_root_cover_within_the_published_bound() {
    let (root, options) = grid_fixture_displaced(100, 100, 3.0);
    let result = compile(&options, |_| {}).expect("compile");
    assert!(
        assert_dependencies_hold(&result["primitives"][0]) > 0,
        "the grid needs bundles past the root cover"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

/// Checks every streamed primitive of a cooked scene; returns the bundles past the root cover and
/// removes the scene's folder.
fn cooked_scene_dependencies(scene: CookedScene) -> usize {
    let past_roots = scene.result["primitives"]
        .as_array()
        .expect("primitives")
        .iter()
        .filter(|primitive| primitive["streams"].is_object())
        .map(assert_dependencies_hold)
        .sum();
    fs::remove_dir_all(scene.root).expect("cleanup");
    past_roots
}

#[test]
fn the_engine_scenes_cook_closed_lists_within_the_published_bound() {
    for (folder, gltf, tag) in ENGINE_SCENES {
        let past_roots =
            cooked_scene_dependencies(cook_fixture(folder, gltf, tag, "qem-endpoints"));
        assert!(
            past_roots > 0,
            "{folder} streams bundles past its root cover"
        );
    }
}

#[test]
fn a_family_of_multi_primitive_scenes_cooks_closed_lists_within_the_published_bound() {
    for (rank, case) in ThinShapes::family().iter().enumerate() {
        let tag = format!("thin-bundles-{rank}");
        let (gltf, bin) = case.document(&tag);
        let scene = cook_scene(&tag, gltf, bin, &[], "qem-endpoints");
        let past_roots = cooked_scene_dependencies(scene);
        assert!(
            past_roots > 0,
            "{case:?} streams bundles past its root cover"
        );
    }
}

#[test]
fn an_open_world_cell_cooks_closed_lists_within_the_published_bound() {
    let cell = cook_fixture(
        "tests/fixtures/openworld-cell",
        "cell.gltf",
        "cell",
        "qem-endpoints",
    );
    let past_roots = cooked_scene_dependencies(cell);
    assert!(
        past_roots > 0,
        "the cell streams bundles past its root cover"
    );
}
