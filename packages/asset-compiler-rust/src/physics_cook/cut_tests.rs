//! The collision cut holds the tolerance it publishes: on every primitive of the engine's test
//! scenes and of a family of generated scenes of thin closed parts, and by the coarsest cut that
//! holds when the tolerance's own cut does not.
use super::cut::{collision_cut, tolerance};
use super::hausdorff;
use super::tests::cluster;
use crate::dag::{build_culling_bvh, build_dag_tallied, DagAttributes, DagCluster, DagStrategy};
use crate::tests::scene_document::ENGINE_SCENES;
use crate::tests::thin_shapes::ThinShapes;
use serde_json::Value;

/// Every primitive of the engine's test scene `<folder>/<gltf>`, whose one buffer is `<tag>.bin`:
/// positions and triangles as drawn, in object space.
fn engine_scene(folder: &str, gltf: &str, tag: &str) -> Vec<(Vec<f32>, Vec<u32>)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(folder);
    let g: Value = serde_json::from_slice(&std::fs::read(dir.join(gltf)).unwrap()).unwrap();
    let bin = std::fs::read(dir.join(format!("{tag}.bin"))).unwrap();
    let read = |id: &Value| crate::accessor(&g, &bin, id.as_u64().unwrap() as usize, None).unwrap();
    let meshes = g["meshes"].as_array().unwrap();
    let primitives = meshes
        .iter()
        .flat_map(|m| m["primitives"].as_array().unwrap());
    primitives
        .map(|p| {
            let positions = read(&p["attributes"]["POSITION"]).collect_f32().unwrap();
            (positions, read(&p["indices"]).collect_u32().unwrap())
        })
        .collect()
}

/// The primitives the collider tests cook: every one of the engine's test scenes, and the wood
/// and the roof of every case of the family.
fn collider_sources() -> Vec<(String, Vec<f32>, Vec<u32>)> {
    let mut out = Vec::new();
    for (folder, gltf, tag) in ENGINE_SCENES {
        for (rank, (positions, indices)) in engine_scene(folder, gltf, tag).into_iter().enumerate()
        {
            out.push((format!("{folder} #{rank}"), positions, indices));
        }
    }
    for case in ThinShapes::family() {
        let [_, wood, roof] = case.surfaces();
        for (name, surface) in [("wood", wood), ("roof", roof)] {
            out.push((
                format!("{name} of {case:?}"),
                surface.positions,
                surface.indices,
            ));
        }
    }
    out
}

// Behaviour: a cooked collider holds its tolerance, on every primitive with a simplified level:
// its measured distance to level 0 is at or under the tolerance, and is the distance the cut
// publishes. Where the tolerance's own cut measures over it (a cluster's error is the simplifier's
// estimate, not a bound), the collider is a finer cut that holds; some primitive of the set needs
// that search, so the set exercises it.
#[test]
fn every_collider_holds_its_tolerance() {
    let (mut checked, mut searched) = (0, 0);
    for (name, pos, source) in collider_sources() {
        let strategy = DagStrategy::named("qem-endpoints");
        let attributes = DagAttributes::default();
        let (dag, ..) = build_dag_tallied(&pos, attributes, &source, strategy, &|| Ok(())).unwrap();
        let t = tolerance(&dag);
        if t == 0.0 {
            continue;
        }
        checked += 1;
        let (order, culling) = build_culling_bvh(&pos, &dag);
        let (tiles, error) = collision_cut(&dag, &order, &culling, &pos, &source, t);
        assert!(error <= t, "{name}: {error} over {t}");
        assert_eq!(
            error,
            hausdorff::distance(&pos, &source, &tiles.concat()),
            "{name}"
        );
        let own: Vec<u32> = dag
            .iter()
            .filter(|c| crate::proxy::cut::selected(c, t))
            .flat_map(|c| c.indices.iter().copied())
            .collect();
        if hausdorff::distance(&pos, &source, &own) > t {
            searched += 1;
        }
    }
    assert!(checked > 0, "no primitive with a simplified level");
    assert!(
        searched > 0,
        "no primitive whose tolerance's own cut measures over it"
    );
}

// Behaviour: when the tolerance's own cut measures over it, the coarsest cut that holds is kept,
// not level 0. Two quads: the first simplifies exactly (estimated 0.1), the second lifts by 0.5
// (estimated 0.2, the tolerance); the kept cut simplifies the first and draws the second.
#[test]
fn the_coarsest_cut_that_holds_is_kept() {
    let quad = |x: f32, y: f32| [x, 0., 0., x + 1., 0., 0., x + 1., y, 1., x, y, 1.];
    let mut pos = Vec::new();
    for (x, y) in [(0., 0.), (0., 0.), (2., 0.), (2., 0.5)] {
        pos.extend(quad(x, y));
    }
    let tris = |q: u32| vec![q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3];
    let with = |indices: Vec<u32>, c: DagCluster| DagCluster { indices, ..c };
    let dag = [
        with(tris(0), cluster(0, 0.0, 0.1)),
        with(tris(1), cluster(1, 0.1, f64::INFINITY)),
        with(tris(2), cluster(0, 0.0, 0.2)),
        with(tris(3), cluster(1, 0.2, f64::INFINITY)),
    ];
    let source = [tris(0), tris(2)].concat();
    let (order, culling) = build_culling_bvh(&pos, &dag);
    let t = tolerance(&dag);
    let (tiles, error) = collision_cut(&dag, &order, &culling, &pos, &source, t);
    let mut kept = tiles.concat();
    kept.sort_unstable();
    let mut expected = [tris(1), tris(2)].concat();
    expected.sort_unstable();
    assert_eq!((t, kept), (0.2, expected));
    assert!(error < 1e-9, "{error}");
}
