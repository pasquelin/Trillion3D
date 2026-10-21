//! Vertex attributes beside the normals: colours, tangents and a second texture set.
use super::attributes::{hard_normals, smooth_normals};
use super::shapes::{amplitude, Banded, Exploded, NX, NY};
use super::*;

/// A colour per band of columns, stepping where two bands meet.
pub(super) fn vertex_colour_steps(seed: u64) -> Case {
    let mut rng = seeded(seed);
    let width = rng.between(4, 16);
    let amplitude = amplitude(&mut rng);
    let bands = Banded::new(&mut rng, NX, NY, amplitude, width);
    let palette: Vec<[f32; 3]> = (0..NX.div_ceil(width))
        .map(|_| [rng.unit(), rng.unit(), rng.unit()])
        .collect();
    let colours = bands.band.iter().flat_map(|&b| palette[b]).collect();
    let mut case = Case::new("attributes-colour-steps", bands.positions, bands.indices);
    case.colours = Some((3, colours));
    case
}

/// Tangents beside the normals: an attribute the page does not carry, which must still compile.
pub(super) fn tangents_present(seed: u64) -> Case {
    let mut case = smooth_normals(seed);
    case.name = "attributes-tangents";
    let tangents = (0..case.vertex_count())
        .flat_map(|_| [1.0, 0.0, 0.0, 1.0])
        .collect();
    case.tangents = Some(tangents);
    case.uv0 = Some(
        (0..case.vertex_count())
            .flat_map(|v| {
                [
                    (v % (NX + 1)) as f32 / NX as f32,
                    (v / (NX + 1)) as f32 / NY as f32,
                ]
            })
            .collect(),
    );
    case
}

/// Colours and a mirrored second texture set on flat-shaded quads, all at once. Both sets are
/// laid out per quad corner, so every vertex is a seam corner of both: each copy merges as a wedge
/// of its own, with its own attributes (`simplify/region/collapse.rs`).
pub(super) fn every_attribute(seed: u64) -> Case {
    let mut case = hard_normals(seed);
    case.name = "attributes-every-one";
    let mut rng = seeded(seed ^ 0x5EED);
    let count = case.vertex_count();
    case.uv0 = Some(
        (0..count)
            .flat_map(|v| {
                let (cx, cy) = Exploded::corner_of(v);
                [cx as f32, cy as f32]
            })
            .collect(),
    );
    case.uv1 = Some(
        (0..count)
            .flat_map(|v| {
                let (cx, cy) = Exploded::corner_of(v);
                [1.0 - cx as f32, cy as f32]
            })
            .collect(),
    );
    case.colours = Some((
        4,
        (0..count)
            .flat_map(|_| [rng.unit(), rng.unit(), rng.unit(), 1.0])
            .collect(),
    ));
    case.tangents = Some((0..count).flat_map(|_| [0.0, 1.0, 0.0, -1.0]).collect());
    case
}
