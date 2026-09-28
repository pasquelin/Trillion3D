//! Tiled grids: a primitive narrower than a tile of the world keeps the grid it had, a wider one
//! is quantized tile by tile on the same absolute grid, and a kilometre terrain seen from 2 m
//! quantizes under the display quantum.

use super::{tile_log2, TILE_EXTENT_LOG2};
use crate::compute_bench::inputs::Xorshift;
use crate::dag::{build_dag_tallied, DagAttributes, DagStrategy};
use crate::geometry_page::encode;
use crate::geometry_page_quant::{primitive_exponent, UV_EXPONENT};
use crate::tests::fixtures::grid_indices;
use trillion3d_page_codec::bits::grid::grid_exponent;
use trillion3d_page_codec::bits::{MAX_BITS, MAX_EXPONENT};

/// The grid rule before tiles: a tile no primitive reaches leaves the extent rule whole.
fn untiled(extent: f64, finest_error: Option<f64>) -> i32 {
    grid_exponent(extent, finest_error, i32::MAX)
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
    // 2^6: the first extent whose floor(log2) the tile clamps.
    let bound = 2f64.powi(TILE_EXTENT_LOG2 + 1);
    for _ in 0..100_000 {
        let extent = f64::from(rng.unit()) * bound;
        let error = match rng.below(3) {
            0 => None,
            1 => Some(f64::from(rng.unit()) * 4.0),
            _ => Some(2f64.powi(rng.between(0, 80) as i32 - 60)),
        };
        assert_eq!(
            grid_exponent(extent, error, TILE_EXTENT_LOG2),
            untiled(extent, error),
            "{extent} {error:?}"
        );
    }
    // An empty primitive and a single point: no extent, the grid they had.
    for positions in [&[][..], &[3.0, -4.0, 5.0]] {
        assert_eq!(
            primitive_exponent(positions, [].into_iter(), false, TILE_EXTENT_LOG2),
            untiled(0.0, None)
        );
    }
    for extent in EDGES.into_iter().filter(|e| e.is_nan() || *e < bound) {
        for error in EDGES.into_iter().map(Some).chain([None]) {
            assert_eq!(
                grid_exponent(extent, error, TILE_EXTENT_LOG2),
                untiled(extent, error),
                "{extent} {error:?}"
            );
        }
    }
}

#[test]
fn a_wider_primitive_is_never_coarser_and_its_widest_page_still_fits() {
    let mut rng = Xorshift::new(913);
    for i in 0..100_000 + EDGES.len() {
        let random = 2f64.powf(f64::from(rng.unit()) * 40.0 - 8.0);
        let extent = EDGES
            .get(i.wrapping_sub(100_000))
            .copied()
            .unwrap_or(random);
        let error = (rng.below(2) == 0).then(|| f64::from(rng.unit()) * 16.0);
        let tiled = grid_exponent(extent, error, TILE_EXTENT_LOG2);
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

#[test]
fn the_tile_is_measured_in_metres_of_the_world() {
    // Under 32 m of the world, whatever the object units, a primitive keeps its grid.
    let mut rng = Xorshift::new(32);
    for _ in 0..100_000 {
        let scale = 2f64.powf(f64::from(rng.unit()) * 24.0 - 12.0);
        let extent = f64::from(rng.unit()) * 32.0 / scale;
        let error = (rng.below(2) == 0).then(|| f64::from(rng.unit()) / scale);
        let tile = tile_log2(Some(scale));
        assert_eq!(
            grid_exponent(extent, error, tile),
            untiled(extent, error),
            "{extent} {scale}"
        );
    }
    // A hall modelled in centimetres-like units, 3,720 of them at a scale of 0.008 (Sponza).
    let hall = [0.0, 0.0, 0.0, 3720.0, 1550.0, 2290.0];
    assert_eq!(
        primitive_exponent(&hall, [].into_iter(), false, tile_log2(Some(0.008))),
        untiled(3720.0, None)
    );
    // A kilometre terrain modelled in kilometres: the same world step as one modelled in metres.
    let terrain = [0.0, 0.0, 0.0, 1.024, 0.05, 1.024];
    let step = 2f64.powi(primitive_exponent(
        &terrain,
        [].into_iter(),
        false,
        tile_log2(Some(1e3)),
    )) * 1e3;
    assert!(step <= 2f64.powi(TILE_EXTENT_LOG2 - 16), "{step}");
    // A scale that places nothing measurable leaves object units as metres; an extreme one still
    // yields a grid the field holds.
    for scale in [
        None,
        Some(f64::NAN),
        Some(0.0),
        Some(-0.0),
        Some(-1.0),
        Some(f64::INFINITY),
        Some(f64::NEG_INFINITY),
    ] {
        assert_eq!(tile_log2(scale), TILE_EXTENT_LOG2, "{scale:?}");
    }
    for scale in [5e-324, f64::MIN_POSITIVE, f64::MAX] {
        for extent in EDGES {
            let exponent = grid_exponent(extent, None, tile_log2(Some(scale)));
            assert!(exponent.abs() <= MAX_EXPONENT, "{extent} {scale}");
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
    let indices = grid_indices(quads, quads, |x, y| (y * (quads + 1) + x) as u32);
    (positions, indices)
}

#[test]
fn a_kilometre_terrain_seen_from_two_metres_quantizes_under_the_display_quantum() {
    // Half a pixel at 2 m on the reference display, 1117 lines at DPR 2, under a 60° vertical
    // field: 0.52 mm.
    let quantum = 0.5 * 2.0 * 2.0 * (30f64).to_radians().tan() / 2234.0;
    let (positions, indices) = terrain(1024.0, 128);
    let dag = build_dag_tallied(
        &positions,
        DagAttributes { carried: &[] },
        &indices,
        DagStrategy::QemEndpoints,
        &|| Ok(()),
    )
    .expect("dag")
    .clusters;
    let errors = || dag.iter().filter(|c| c.level > 0).map(|c| c.lod_error);
    let exponent = primitive_exponent(&positions, errors(), false, TILE_EXTENT_LOG2);
    assert_eq!(exponent, TILE_EXTENT_LOG2 - 16);
    let before = primitive_exponent(&positions, errors(), false, i32::MAX);
    let worst = |grid| {
        dag.iter()
            .map(|cluster| {
                let page = encode(&cluster.indices, &positions, &[], grid, UV_EXPONENT);
                f64::from(page.expect("page").header.quantization_error)
            })
            .fold(0.0, f64::max)
    };
    let (tiled, untiled) = (worst(exponent), worst(before));
    assert!(tiled < quantum, "tiled: {tiled} against {quantum}");
    assert!(
        untiled > quantum,
        "untiled was an image loss: {untiled} against {quantum}"
    );
}
