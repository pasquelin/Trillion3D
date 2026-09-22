//! Texture layouts: where an artist's seams fall, and what the DAG owes each layout.
use super::shapes::{amplitude, face_normal, Banded, Exploded, Sheet, NX, NY};
use super::*;

/// The whole sheet under one chart.
fn one_island(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let amplitude = amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, NX, NY, amplitude);
    let uv = (0..sheet.positions.len() / 3)
        .flat_map(|v| {
            [
                sheet.x_of(v) as f32 / NX as f32,
                sheet.y_of(v) as f32 / NY as f32,
            ]
        })
        .collect();
    let mut case = Case::new("uv-one-island", sheet.positions, sheet.indices);
    case.uv0 = Some(uv);
    case
}

/// Every triangle its own chart in an atlas: three vertices per triangle, none shared, so every
/// position is a seam corner written as many times as it has triangles. Nothing can move:
/// `seam-locked`. Observed: the diagnosis names one group of seed 1 (2 072 triangles, 181 shared
/// positions, the most of the case) `border-locked` instead, which says only that its reduction
/// advanced once its locks were lifted; why is not explained here. The corpus accepts both causes,
/// no other.
fn island_per_face(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let amplitude = amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, NX, NY, amplitude);
    let triangles = sheet.indices.len() / 3;
    let cells = (triangles as f32).sqrt().ceil() as usize;
    let (mut positions, mut uv, mut indices) = (Vec::new(), Vec::new(), Vec::new());
    for (triangle, corners) in sheet.indices.chunks(3).enumerate() {
        let (cell_x, cell_y) = (triangle % cells, triangle / cells);
        for (rank, &corner) in corners.iter().enumerate() {
            indices.push((positions.len() / 3) as u32);
            positions
                .extend_from_slice(&sheet.positions[corner as usize * 3..corner as usize * 3 + 3]);
            let local = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]][rank];
            uv.extend([
                (cell_x as f32 + local[0]) / cells as f32,
                (cell_y as f32 + local[1]) / cells as f32,
            ]);
        }
    }
    let mut case = Case::new("uv-island-per-face", positions, indices);
    case.uv0 = Some(uv);
    case
}

/// One chart per brick: every vertex is a seam corner, nothing shares a texture coordinate. Only
/// welding the seams frees the groups: `seam-locked`.
fn island_per_brick(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let amplitude = amplitude(&mut rng);
    let bricks = Exploded::new(&mut rng, NX, NY, amplitude);
    let uv = (0..bricks.positions.len() / 3)
        .flat_map(|v| {
            let (cx, cy) = Exploded::corner_of(v);
            [cx as f32, cy as f32]
        })
        .collect();
    let mut case = Case::new("uv-island-per-brick", bricks.positions, bricks.indices);
    case.uv0 = Some(uv);
    case
}

/// The sheet cut into square patches, each a tiny island of an atlas.
fn atlas_of_islands(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let patch = rng.between(2, 5);
    let amplitude = amplitude(&mut rng);
    let bands = Banded::new(&mut rng, NX, NY, amplitude, patch);
    let cells = NX.div_ceil(patch);
    let uv = (0..bands.x.len())
        .flat_map(|v| {
            let (local_x, local_y) = (
                (bands.x[v] - bands.band[v] * patch) as f32,
                bands.y[v] as f32,
            );
            [
                (bands.band[v] as f32 + local_x / patch as f32) / cells as f32,
                local_y / NY as f32,
            ]
        })
        .collect();
    let mut case = Case::new("uv-atlas-of-islands", bands.positions, bands.indices);
    case.uv0 = Some(uv);
    case
}

/// Two halves mapped as mirror images: the UV determinant flips sign across the middle column.
fn mirrored_halves(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let amplitude = amplitude(&mut rng);
    let bands = Banded::new(&mut rng, NX, NY, amplitude, NX / 2);
    let uv = (0..bands.x.len())
        .flat_map(|v| {
            let u = bands.x[v] as f32 / (NX / 2) as f32;
            [
                if bands.band[v] == 0 { u } else { 2.0 - u },
                bands.y[v] as f32 / NY as f32,
            ]
        })
        .collect();
    let mut case = Case::new("uv-mirrored-halves", bands.positions, bands.indices);
    case.uv0 = Some(uv);
    case
}

/// One chart repeated several times across the sheet: coordinates beyond `[0, 1]`, wrapped.
fn tiled_beyond_unit(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let repeats = rng.between(2, 8) as f32;
    let amplitude = amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, NX, NY, amplitude);
    let uv = (0..sheet.positions.len() / 3)
        .flat_map(|v| {
            [
                sheet.x_of(v) as f32 / NX as f32 * repeats,
                sheet.y_of(v) as f32 / NY as f32 * repeats,
            ]
        })
        .collect();
    let mut case = Case::new("uv-tiled-beyond-unit", sheet.positions, sheet.indices);
    case.uv0 = Some(uv);
    case
}

/// Flat-shaded bricks under a continuous first set and a per-brick second set: `TEXCOORD_1`
/// has seams the first set does not. Every vertex is a seam corner of that second set, so the
/// weld that respects it merges nothing and the groups stall — a property of the layout, not a
/// defect: coarsening it would draw a brick with its neighbour's second texture. `seam-locked`.
fn second_set_with_own_seams(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let amplitude = amplitude(&mut rng);
    let bricks = Exploded::new(&mut rng, NX, NY, amplitude);
    let (mut uv0, mut uv1, mut normals) = (Vec::new(), Vec::new(), Vec::new());
    for v in 0..bricks.positions.len() / 3 {
        let (qx, qy) = bricks.quad_of(v);
        let (cx, cy) = Exploded::corner_of(v);
        uv0.extend([(qx + cx) as f32 / NX as f32, (qy + cy) as f32 / NY as f32]);
        uv1.extend([cx as f32, cy as f32]);
        normals.extend(face_normal(&bricks.positions, v / 4 * 4));
    }
    let mut case = Case::new(
        "uv-second-set-with-own-seams",
        bricks.positions,
        bricks.indices,
    );
    case.normals = Some(normals);
    case.uv0 = Some(uv0);
    case.uv1 = Some(uv1);
    case
}

pub(super) fn cases() -> Vec<(Generator, Expect)> {
    vec![
        (one_island as Generator, Expect::ONE_ROOT),
        (
            island_per_face,
            Expect::stalled(&["seam-locked", "border-locked"]),
        ),
        (island_per_brick, Expect::stalled(&["seam-locked"])),
        (atlas_of_islands, Expect::ONE_ROOT),
        (mirrored_halves, Expect::ONE_ROOT),
        (tiled_beyond_unit, Expect::ONE_ROOT),
        (second_set_with_own_seams, Expect::stalled(&["seam-locked"])),
    ]
}
