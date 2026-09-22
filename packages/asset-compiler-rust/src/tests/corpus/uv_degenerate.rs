//! Texture layouts that carry no usable area: a chart collapsed to a line, a chart collapsed to a
//! point, and no texture at all. The DAG owes them the same coarsening as a well-laid atlas.
use super::shapes::{amplitude, Sheet, NX, NY};
use super::*;

/// A band of columns mapped to a single `u`: its triangles have no area in texture space.
fn zero_area_uv_triangles(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let (from, width) = (rng.between(8, 40), rng.between(2, 8));
    let amplitude = amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, NX, NY, amplitude);
    let uv = (0..sheet.positions.len() / 3)
        .flat_map(|v| {
            let x = sheet.x_of(v);
            let mapped = if x < from {
                x
            } else if x < from + width {
                from
            } else {
                x - width
            };
            [mapped as f32 / NX as f32, sheet.y_of(v) as f32 / NY as f32]
        })
        .collect();
    let mut case = Case::new("uv-zero-area-triangles", sheet.positions, sheet.indices);
    case.uv0 = Some(uv);
    case
}

/// Every vertex mapped to the same texel.
fn all_uvs_at_one_point(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let point = [rng.unit(), rng.unit()];
    let amplitude = amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, NX, NY, amplitude);
    let uv = (0..sheet.positions.len() / 3).flat_map(|_| point).collect();
    let mut case = Case::new("uv-all-at-one-point", sheet.positions, sheet.indices);
    case.uv0 = Some(uv);
    case
}

/// No texture coordinates at all.
fn no_uvs(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let amplitude = amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, NX, NY, amplitude);
    Case::new("uv-none", sheet.positions, sheet.indices)
}

pub(super) fn cases() -> Vec<(Generator, Expect)> {
    vec![
        (zero_area_uv_triangles, Expect::ONE_ROOT),
        (all_uvs_at_one_point, Expect::ONE_ROOT),
        (no_uvs, Expect::ONE_ROOT),
    ]
}
