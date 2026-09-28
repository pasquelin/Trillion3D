//! The physics cook in parallel is the serial cook, byte for byte (#956, audit CMP-13): the
//! distance a collision search measures, and a whole primitive's collider and pages, computed on
//! one thread and on many, on random inputs and on the edge cases (empty, one triangle, NaN, ±0,
//! ±Inf, a mesh of many tiles).
use super::hausdorff::{one_sided_distance, Level0};
use crate::compiler_primitive_dag::{build_dag_primitive, DagResult};
use crate::compute_bench::inputs::Xorshift;
use crate::tests::fixtures::{files, grid_indices, portable_sin};
use serde_json::Value;
use std::path::Path;
use std::sync::OnceLock;

/// Runs `work` on the compiler's pool of one thread, the serial cook, or of eight.
fn on<T: Send>(parallel: bool, work: impl FnOnce() -> T + Send) -> T {
    static POOLS: OnceLock<[rayon::ThreadPool; 2]> = OnceLock::new();
    let pools =
        POOLS.get_or_init(|| [1, 8].map(|n| crate::perf::JobPhases::default().pool(n).unwrap()));
    pools[usize::from(parallel)].install(work)
}

/// The distance as measured before #956: one side after the other, on one thread.
fn serial_distance(pos: &[f32], level0: &[u32], cut: &[u32]) -> u64 {
    on(false, || {
        let there = one_sided_distance(pos, level0, cut);
        there.max(one_sided_distance(pos, cut, level0)).to_bits()
    })
}

fn assert_same_distance(pos: &[f32], level0: &[u32], cut: &[u32]) {
    let parallel = on(true, || Level0::new(pos, level0).distance(cut).to_bits());
    assert_eq!(
        parallel,
        serial_distance(pos, level0, cut),
        "{pos:?} {level0:?} {cut:?}"
    );
}

/// A surface of `n`² vertices, bumped and jittered so it is no regular grid.
fn surface(n: usize, random: &mut Xorshift) -> (Vec<f32>, Vec<u32>) {
    let mut pos = Vec::new();
    for z in 0..n {
        for x in 0..n {
            let (px, pz) = (
                x as f32 + random.unit() * 0.3,
                z as f32 + random.unit() * 0.3,
            );
            pos.extend([
                px,
                portable_sin(px * 0.37) * portable_sin(pz * 0.23) * 2.0,
                pz,
            ]);
        }
    }
    let triangles = grid_indices(n - 1, n - 1, |x, z| (z * n + x) as u32);
    (pos, triangles)
}

// Behaviour: on 10,000 random meshes — a coordinate sometimes NaN or ±0 — and a random cut of
// each, the distance a search measures on the pool is the serial one, bit for bit.
#[test]
fn a_cut_measures_the_serial_distance_on_random_meshes() {
    let mut random = Xorshift::new(956);
    let special = [f32::NAN, 0.0, -0.0];
    for _ in 0..10_000 {
        let vertices = 3 + random.below(22);
        let pos: Vec<f32> = (0..vertices * 3)
            .map(|_| match random.below(40) {
                0 => special[random.below(special.len())],
                _ => random.unit() * 4.0 - 2.0,
            })
            .collect();
        let triangles = |r: &mut Xorshift| -> Vec<u32> {
            let count = r.below(12);
            (0..count * 3).map(|_| r.below(vertices) as u32).collect()
        };
        let (level0, cut) = (triangles(&mut random), triangles(&mut random));
        assert_same_distance(&pos, &level0, &cut);
    }
}

// Behaviour: the edge cases measure the serial distance too — empty sides, one triangle, an
// infinite vertex on both sides, and a mesh of 8,192 triangles against its every other one.
#[test]
fn a_cut_measures_the_serial_distance_on_edge_cases() {
    let one = [0., 0., 0., 1., 0., 0., 0., 1., 0.];
    assert_same_distance(&one, &[], &[]);
    assert_same_distance(&one, &[0, 1, 2], &[]);
    assert_same_distance(&one, &[], &[0, 1, 2]);
    assert_same_distance(&one, &[0, 1, 2], &[0, 1, 2]);
    for infinite in [f32::INFINITY, f32::NEG_INFINITY] {
        let mut pos = one.to_vec();
        pos.extend([infinite, 0.5, -0.0]);
        assert_same_distance(&pos, &[0, 1, 2, 1, 3, 2], &[0, 1, 3]);
    }
    let (pos, level0) = surface(65, &mut Xorshift::new(13));
    let halved: Vec<u32> = level0
        .chunks(6)
        .flat_map(|quad| quad[..3].to_vec())
        .collect();
    assert_same_distance(&pos, &level0, &halved);
}

/// A primitive built on one thread or many into its own store: its result and every object stored.
fn primitive(parallel: bool, pos: &[f32], triangles: &[u32], root: &Path) -> (Value, Vec<Vec<u8>>) {
    let mut o = crate::texture_preview::tests::options(root);
    o.simplification = "qem-endpoints".into();
    let demand = crate::proxy::cut::cut_demand(None, 4096, triangles.len() / 3, 0);
    let tile = crate::geometry_page_quant::tile::tile_log2(None);
    let uv = crate::geometry_page_quant::primitive_uv_exponent(&[], false);
    let store = |slice: &[u32], exponent: i32| {
        crate::compiler_page_object::store_page(&o, slice, pos, &[], exponent, uv)
    };
    let built = on(parallel, || {
        build_dag_primitive(&o, pos, &[], triangles, demand, false, tile, &store)
    });
    let result = match built {
        Ok(DagResult {
            pages,
            collision,
            reused,
            stream_report,
            position_exponent,
            ..
        }) => {
            serde_json::json!([pages, collision, reused, stream_report, position_exponent])
        }
        Err(e) => serde_json::json!({"error": e.code, "message": e.message}),
    };
    let mut stored = files(&o.cache);
    stored.sort();
    (
        result,
        stored.iter().map(|p| std::fs::read(p).unwrap()).collect(),
    )
}

fn assert_same_primitive(name: &str, pos: &[f32], triangles: &[u32]) {
    let root = crate::texture_preview::tests::temp_dir(name);
    let serial = primitive(false, pos, triangles, &root.join("serial"));
    let parallel = primitive(true, pos, triangles, &root.join("parallel"));
    std::fs::remove_dir_all(&root).ok();
    assert_eq!(parallel.0, serial.0, "{name}: result");
    assert!(parallel.1 == serial.1, "{name}: stored objects differ");
}

// Behaviour: a primitive's collider and pages, cooked side by side on the pool, are the serial
// cook's, in the same order and with the same stored bytes: an empty primitive, one triangle, a
// random surface and a surface of several collision tiles.
#[test]
fn a_primitive_cooks_the_serial_bytes_on_many_threads() {
    assert_same_primitive("empty", &[], &[]);
    assert_same_primitive("one", &[0., 0., 0., 1., 0., 0., 0., 0., 1.], &[0, 1, 2]);
    let mut random = Xorshift::new(27);
    let (pos, triangles) = surface(24, &mut random);
    assert_same_primitive("random", &pos, &triangles);
    let (pos, triangles) = surface(129, &mut random);
    assert_same_primitive("tiled", &pos, &triangles);
}
