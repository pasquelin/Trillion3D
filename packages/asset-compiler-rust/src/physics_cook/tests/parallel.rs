//! The physics cook in parallel is the serial cook, byte for byte: the
//! distance a collision search measures, computed on one thread and on many, on random inputs and
//! on the edge cases (empty, one triangle, NaN, ±0, ±Inf, a mesh of many tiles). A whole
//! primitive's collider and pages: `parallel/primitive.rs`.
pub(crate) mod primitive;
use crate::physics_cook::hausdorff::reference::one_sided_distance;
use crate::physics_cook::hausdorff::Level0;
use crate::tests::fixtures::{grid_indices, portable_sin};
use crate::tests::random::Xorshift;
use std::sync::OnceLock;

/// Runs `work` on the compiler's pool of one thread, the serial cook, or of eight.
pub(crate) fn on<T: Send>(parallel: bool, work: impl FnOnce() -> T + Send) -> T {
    static POOLS: OnceLock<[rayon::ThreadPool; 2]> = OnceLock::new();
    let pools = POOLS.get_or_init(|| {
        [1, 8].map(|n| crate::support::perf::JobPhases::default().pool(n).unwrap())
    });
    pools[usize::from(parallel)].install(work)
}

/// The distance measured serially, one side after the other, and as a search measures it
/// on the pool: both as bits.
fn serial_distance(pos: &[f32], level0: &[u32], cut: &[u32]) -> u64 {
    let there = one_sided_distance(pos, level0, cut);
    there.max(one_sided_distance(pos, cut, level0)).to_bits()
}
fn parallel_distance(pos: &[f32], level0: &[u32], cut: &[u32]) -> u64 {
    Level0::new(pos, level0).distance(cut, 0.0).to_bits()
}

/// Every case measured on one thread, then on many, in one pass each.
fn assert_same_distances(cases: &[(Vec<f32>, Vec<u32>, Vec<u32>)]) {
    let measure = |parallel: bool| -> Vec<u64> {
        let each = if parallel {
            parallel_distance
        } else {
            serial_distance
        };
        on(parallel, || {
            cases.iter().map(|(p, a, b)| each(p, a, b)).collect()
        })
    };
    let (serial, parallel) = (measure(false), measure(true));
    for (case, (s, p)) in cases.iter().zip(serial.iter().zip(&parallel)) {
        assert_eq!(p, s, "{case:?}");
    }
}

fn assert_same_distance(pos: &[f32], level0: &[u32], cut: &[u32]) {
    assert_same_distances(&[(pos.to_vec(), level0.to_vec(), cut.to_vec())]);
}

/// A surface of `n`² vertices, bumped and jittered so it is no regular grid.
pub(crate) fn surface(n: usize, random: &mut Xorshift) -> (Vec<f32>, Vec<u32>) {
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
    let mut cases = Vec::new();
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
        cases.push((pos, level0, cut));
    }
    assert_same_distances(&cases);
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
