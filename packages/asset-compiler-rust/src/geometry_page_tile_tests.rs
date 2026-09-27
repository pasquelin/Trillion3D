//! Tiled grids: a primitive narrower than a tile keeps the grid it had, a wider one is quantized
//! tile by tile on the same absolute grid, and a kilometre terrain seen from 2 m quantizes under
//! the display quantum.

use crate::compute_bench::inputs::Xorshift;
use crate::dag::{build_dag_tallied, DagAttributes, DagStrategy};
use crate::geometry_page::encode;
use crate::geometry_page_quant::{grid_exponent, primitive_exponent, TILE_EXTENT_LOG2};
use trillion3d_page_codec::bits::{MAX_BITS, MAX_EXPONENT};

/// The grid rule before tiles, kept as the witness the tiled rule is compared with: the finest
/// of the extent and error rules, bounded by the widest page the field holds.
fn untiled(extent: f64, finest_error: Option<f64>) -> i32 {
    let widest = match extent > 0.0 {
        true => extent.log2().floor() as i32,
        false => 0,
    };
    let rules = [
        Some(widest - 16),
        finest_error.map(|e| (e / 8.0).log2().floor() as i32),
    ];
    let chosen = rules.into_iter().flatten().min().unwrap_or(widest - 16);
    chosen
        .max(widest + 2 - MAX_BITS as i32)
        .clamp(-MAX_EXPONENT, MAX_EXPONENT)
}

/// Extents and errors a primitive can publish, the hostile ones included.
const EDGES: [f64; 12] = [
    0.0,
    -0.0,
    f64::NAN,
    f64::INFINITY,
    f64::NEG_INFINITY,
    f64::MAX,
    f64::MIN_POSITIVE,
    5e-324,
    1.0,
    32.0,
    63.999,
    64.0,
];

#[test]
fn a_primitive_narrower_than_a_tile_keeps_its_grid() {
    let mut rng = Xorshift::new(930);
    let tile = 2f64.powi(TILE_EXTENT_LOG2 + 1);
    for _ in 0..100_000 {
        let extent = f64::from(rng.unit()) * tile;
        let error = match rng.below(3) {
            0 => None,
            1 => Some(f64::from(rng.unit()) * 4.0),
            _ => Some(2f64.powi(rng.between(0, 80) as i32 - 60)),
        };
        assert_eq!(
            grid_exponent(extent, error),
            untiled(extent, error),
            "{extent} {error:?}"
        );
    }
    for extent in EDGES.into_iter().filter(|e| e.is_nan() || *e < tile) {
        for error in EDGES.into_iter().map(Some).chain([None]) {
            assert_eq!(
                grid_exponent(extent, error),
                untiled(extent, error),
                "{extent} {error:?}"
            );
        }
    }
}

#[test]
fn a_wider_primitive_is_never_coarser_and_its_widest_page_still_fits() {
    let mut rng = Xorshift::new(913);
    let extents: Vec<f64> = (0..100_000)
        .map(|_| 2f64.powf(f64::from(rng.unit()) * 40.0 - 8.0))
        .collect();
    for extent in extents.into_iter().chain(EDGES) {
        let error = (rng.below(2) == 0).then(|| f64::from(rng.unit()) * 16.0);
        let tiled = grid_exponent(extent, error);
        assert!(tiled <= untiled(extent, error), "{extent} {error:?}");
        if extent.is_finite() && extent > 0.0 {
            // The whole primitive, one page wide, on its own grid: under 2^MAX_BITS steps.
            let steps = extent / 2f64.powi(tiled);
            assert!(
                steps < 2f64.powi(MAX_BITS as i32) || tiled == MAX_EXPONENT,
                "{extent}"
            );
        }
    }
}

/// A terrain of `quads × quads` cells over `size` metres, its relief drawn from the seed.
fn terrain(size: f32, quads: usize) -> (Vec<f32>, Vec<u32>) {
    let mut rng = Xorshift::new(1024);
    let spacing = size / quads as f32;
    let mut positions = Vec::with_capacity((quads + 1) * (quads + 1) * 3);
    for y in 0..=quads {
        for x in 0..=quads {
            let (fx, fy) = (x as f32 * spacing, y as f32 * spacing);
            let relief = 40.0 * (fx * 0.011).sin() * (fy * 0.007).cos();
            positions.extend([fx, fy, relief + rng.unit() * 0.3]);
        }
    }
    let row = quads as u32 + 1;
    let mut indices = Vec::with_capacity(quads * quads * 6);
    for y in 0..quads as u32 {
        for x in 0..quads as u32 {
            let a = y * row + x;
            indices.extend([a, a + 1, a + row, a + 1, a + row + 1, a + row]);
        }
    }
    (positions, indices)
}

#[test]
fn a_kilometre_terrain_seen_from_two_metres_quantizes_under_the_display_quantum() {
    // Half a pixel at 2 m on 1080 lines under a 60° vertical field: 1.07 mm.
    let quantum = 0.5 * 2.0 * 2.0 * (30f64).to_radians().tan() / 1080.0;
    let (positions, indices) = terrain(1024.0, 128);
    let (dag, ..) = build_dag_tallied(
        &positions,
        DagAttributes { carried: &[] },
        &indices,
        DagStrategy::QemEndpoints,
        &|| Ok(()),
    )
    .expect("dag");
    let errors = || dag.iter().filter(|c| c.level > 0).map(|c| c.lod_error);
    let exponent = primitive_exponent(&positions, errors());
    assert_eq!(exponent, TILE_EXTENT_LOG2 - 16);
    let finest = errors().filter(|e| *e > 0.0).min_by(f64::total_cmp);
    let before = untiled(1024.0, finest);
    let mut worst = [0f64; 2];
    for cluster in &dag {
        for (slot, grid) in [exponent, before].into_iter().enumerate() {
            let page = encode(&cluster.indices, &positions, &[], grid).expect("page");
            worst[slot] = worst[slot].max(f64::from(page.header.quantization_error));
        }
    }
    assert!(worst[0] < quantum, "tiled: {worst:?} against {quantum}");
    assert!(worst[1] > quantum, "untiled was an image loss: {worst:?}");
}
