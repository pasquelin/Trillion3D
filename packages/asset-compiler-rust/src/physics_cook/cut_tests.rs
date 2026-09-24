//! The collision cut holds the tolerance it publishes: on the hall example, and by the coarsest
//! cut that holds when the tolerance's own cut does not.
use super::cut::{collision_cut, tolerance};
use super::hausdorff;
use super::tests::cluster;
use crate::dag::{build_culling_bvh, build_dag_tallied, DagCluster, DagStrategy};
use serde_json::Value;

/// The hall example's stone primitive, as drawn: positions and triangles read from its source.
fn hall_stone() -> (Vec<f32>, Vec<u32>) {
    let dir = "../../site/assets/examples/hall/source";
    let read = |name: &str| std::fs::read(format!("{dir}/{name}")).unwrap();
    let (g, bin): (Value, _) = (
        serde_json::from_slice(&read("geometry.gltf")).unwrap(),
        read("scene.bin"),
    );
    let words = |accessor: &Value| {
        let accessor = &g["accessors"][accessor.as_u64().unwrap() as usize];
        let view = &g["bufferViews"][accessor["bufferView"].as_u64().unwrap() as usize];
        let at = view["byteOffset"].as_u64().unwrap() as usize;
        let bytes = &bin[at..at + view["byteLength"].as_u64().unwrap() as usize];
        bytes.as_chunks::<4>().0.to_vec()
    };
    let primitive = &g["meshes"][0]["primitives"][1];
    let pos = words(&primitive["attributes"]["POSITION"]);
    let indices = words(&primitive["indices"]);
    (
        pos.into_iter().map(f32::from_le_bytes).collect(),
        indices.into_iter().map(u32::from_le_bytes).collect(),
    )
}

// Behaviour: a cooked collider holds its tolerance. On the hall example the cut at the tolerance
// measured 10.3 mm against 7.8 mm; the collider published now measures within it.
#[test]
fn the_hall_collider_holds_its_tolerance() {
    let (pos, source) = hall_stone();
    let strategy = DagStrategy::named("qem-endpoints");
    let (dag, ..) = build_dag_tallied(&pos, &[], &source, strategy, &|| Ok(())).unwrap();
    let (order, culling) = build_culling_bvh(&pos, &dag);
    let t = tolerance(&dag);
    let (tiles, error) = collision_cut(&dag, &order, &culling, &pos, &source, t);
    assert!(t > 0.0 && error <= t, "{error} over {t}");
    assert_eq!(error, hausdorff::distance(&pos, &source, &tiles.concat()));
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
