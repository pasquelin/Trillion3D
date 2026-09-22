//! Vertex attributes beside the texture: normals, colours and tangents, present or not.
use super::shapes::{amplitude, face_normal, Banded, Exploded, Sheet, NX, NY};
use super::*;

/// Flat shading: every quad owns its vertices and carries its face normal.
fn hard_normals(seed: u64) -> Case {
    let mut rng = seeded(seed);
    let amplitude = amplitude(&mut rng);
    let quads = Exploded::new(&mut rng, NX, NY, amplitude);
    let normals = (0..quads.positions.len() / 3)
        .flat_map(|v| face_normal(&quads.positions, v / 4 * 4))
        .collect();
    let mut case = Case::new("attributes-hard-normals", quads.positions, quads.indices);
    case.normals = Some(normals);
    case
}

/// Smooth shading: one normal per shared vertex, from the relief's finite differences.
fn smooth_normals(seed: u64) -> Case {
    let mut rng = seeded(seed);
    let amplitude = amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, NX, NY, amplitude);
    let z = |x: usize, y: usize| sheet.positions[sheet.vertex(x, y) as usize * 3 + 2];
    let normals = (0..sheet.positions.len() / 3)
        .flat_map(|v| {
            let (x, y) = (sheet.x_of(v), sheet.y_of(v));
            let dx = (z((x + 1).min(NX), y) - z(x.saturating_sub(1), y)) / 2.0;
            let dy = (z(x, (y + 1).min(NY)) - z(x, y.saturating_sub(1))) / 2.0;
            let length = (dx * dx + dy * dy + 1.0).sqrt();
            [-dx / length, -dy / length, 1.0 / length]
        })
        .collect();
    let mut case = Case::new("attributes-smooth-normals", sheet.positions, sheet.indices);
    case.normals = Some(normals);
    case
}

/// A colour per band of columns, stepping where two bands meet.
fn vertex_colour_steps(seed: u64) -> Case {
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
fn tangents_present(seed: u64) -> Case {
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
/// laid out per quad corner, so every vertex is a seam corner of both and the groups stall:
/// a property of the layout, not a defect.
fn every_attribute(seed: u64) -> Case {
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

pub(super) fn cases() -> Vec<(Generator, Expect)> {
    vec![
        (hard_normals, Expect::ONE_ROOT),
        (smooth_normals, Expect::ONE_ROOT),
        (vertex_colour_steps, Expect::ONE_ROOT),
        (tangents_present, Expect::ONE_ROOT),
        (every_attribute, Expect::stalled("noCollapse")),
    ]
}
