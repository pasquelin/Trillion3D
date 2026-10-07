//! What the tiled grid costs on screen: a primitive wider than a tile, seen from a metre,
//! quantizes under the display quantum, and a kilometre terrain takes the finest grid its root
//! page fits.

use super::TILE_EXTENT_LOG2;
use crate::dag::{build_dag_tallied, DagAttributes, DagStrategy};
use crate::geometry_page::encode;
use crate::geometry_page_quant::{primitive_exponent, UV_EXPONENT};
use crate::tests::fixtures::grid_indices;
use crate::tests::random::Xorshift;
use trillion3d_page_codec::bits::grid::finest_exponent;

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

/// The display quantum (0.1 px), in metres at `depth` metres on the reference display: 2234 lines
/// under a 55° vertical field (`TILE_EXTENT_LOG2`).
fn quantum(depth: f64) -> f64 {
    0.1 * depth * 2.0 * (27.5f64).to_radians().tan() / 2234.0
}

/// The largest displacement of the pages `grid` writes, 384 corners each, of `positions`.
fn worst_on(grid: i32, positions: &[f32], indices: &[u32]) -> f64 {
    indices
        .chunks(384)
        .map(|cluster| {
            let page = encode(cluster, positions, &[], grid, UV_EXPONENT);
            f64::from(page.expect("page").header.quantization_error)
        })
        .fold(0.0, f64::max)
}

#[test]
fn a_hall_seen_from_a_metre_quantizes_under_the_display_quantum() {
    // A 32 m hall floor, a vertex every 0.5 m, its relief drawn from the seed: wider than a tile,
    // it sits on the tile's grid, whose worst displacement projects under 0.1 px at a metre.
    let (positions, indices) = terrain(32.0, 64);
    let exponent = primitive_exponent(&positions, [].into_iter(), false, TILE_EXTENT_LOG2);
    assert_eq!(exponent, TILE_EXTENT_LOG2 - 16);
    let worst = worst_on(exponent, &positions, &indices);
    assert!(worst < quantum(1.0), "{worst} against {}", quantum(1.0));
    // The 32 m tile it had before was an image loss at a metre.
    let before = worst_on(5 - 16, &positions, &indices);
    assert!(before > quantum(1.0), "{before}");
}

#[test]
fn a_kilometre_terrain_takes_the_finest_grid_its_root_page_fits() {
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
    let exponent = primitive_exponent(&positions, errors(), false, TILE_EXTENT_LOG2);
    // The tile asks 2^-15; the root page spans the kilometre, 2^23 steps of 2^-13 at most.
    assert_eq!(exponent, finest_exponent(1024.0));
    assert_eq!(exponent, -13);
    let before = primitive_exponent(&positions, errors(), false, i32::MAX);
    let worst = |grid| {
        dag.iter()
            .map(|cluster| {
                let page = encode(&cluster.indices, &positions, &[], grid, UV_EXPONENT);
                f64::from(page.expect("every page fits").header.quantization_error)
            })
            .fold(0.0, f64::max)
    };
    let (tiled, untiled) = (worst(exponent), worst(before));
    assert!(
        tiled < quantum(2.0),
        "tiled: {tiled} against {}",
        quantum(2.0)
    );
    assert!(
        untiled > quantum(2.0),
        "untiled was an image loss: {untiled} against {}",
        quantum(2.0)
    );
}
