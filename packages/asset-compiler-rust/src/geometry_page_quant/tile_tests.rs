//! Tiled grids: a primitive narrower than a tile of the world keeps the grid it had, a wider one
//! is quantized tile by tile on the same absolute grid, and every page still fits its field.

use super::{tile_log2, TILE_EXTENT_LOG2};
use crate::geometry_page_quant::primitive_exponent;
use crate::tests::random::Xorshift;
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
    // Under a tile of the world, whatever the object units, a primitive keeps its grid.
    let tile_metres = 2f64.powi(TILE_EXTENT_LOG2);
    let mut rng = Xorshift::new(32);
    for _ in 0..100_000 {
        let scale = 2f64.powf(f64::from(rng.unit()) * 24.0 - 12.0);
        let extent = f64::from(rng.unit()) * tile_metres / scale;
        let error = (rng.below(2) == 0).then(|| f64::from(rng.unit()) / scale);
        let tile = tile_log2(Some(scale));
        assert_eq!(
            grid_exponent(extent, error, tile),
            untiled(extent, error),
            "{extent} {scale}"
        );
    }
    // A hall modelled in centimetre-like units, 3,720 of them at a scale of 0.008 (Sponza): no
    // coarser a world step than a hall modelled in metres.
    let hall = [0.0, 0.0, 0.0, 3720.0, 1550.0, 2290.0];
    let step = 2f64.powi(primitive_exponent(
        &hall,
        [].into_iter(),
        false,
        tile_log2(Some(0.008)),
    )) * 0.008;
    assert!(step <= 2f64.powi(TILE_EXTENT_LOG2 - 16), "{step}");
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
