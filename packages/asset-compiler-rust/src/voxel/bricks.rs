//! Solid voxels packed in 4³ bricks, and the bytes of a brick and of a voxel.
//!
//! A brick: its voxel mask (`u64`, bit `x + 4y + 16z`), its corner in bricks from its group's
//! first (`u16` × 3) and its joint (`u16`, `0xFFFF` for none): 16 bytes. Its voxels follow the
//! mask's bits, 16 bytes each — a group's voxels in its bricks' order, so a brick's first is the
//! group's first plus the popcounts of the masks before it:
//!
//! | bytes | content |
//! |---|---|
//! | 0–3 | base colour, sRGB; normal length (the spread Toksvig's filter reads: 255 when every normal agrees) |
//! | 4–7 | occlusion, roughness, metallic; coverage |
//! | 8–9 | mean normal, octahedral (`oct_encode`) |
//! | 10–11 | contour normal, octahedral |
//! | 12 | contour offset from the voxel's centre along its normal, `i8` over 127 of half the diagonal |
//! | 13 | contour thickness, over 255 of the diagonal |
//! | 14–15 | source material most of its hits land on (`u16`, `0xFFFF` for none): its emission and anything else the voxel does not prefilter are the material's |
//!
//! The contour is the slab `|n · (p − c) − offset| ≤ thickness / 2` that fits best the hits of
//! the face the voxel shows most of — a wall's top voxel shows its facade more than the roof's
//! edge, and one plane through both would lean out over the roof —: their mean, the direction
//! they spread least along — or the mean normal where they do not spread over a plane —, and
//! twice the √3 deviation along it, a uniform spread's width. Where
//! the voxel behind the surface is solid, the slab reaches back to the voxel's far side: a wall
//! voxel's slab and its neighbour's then leave no gap where an empty corner voxel stands between
//! them, through which the inside would show.
use super::axes::symmetric_axes;
use super::raster::Cell;
use super::sample::{symmetric, Moments, FACES};
use super::solid::Voxel;
use crate::texture_preview::linear_to_srgb;
use trillion3d_math::octahedral::oct_encode;
use trillion3d_math::scalar::unit_to_byte;
use trillion3d_math::vec3::{dominant_axis, normalized_or};
use trillion3d_math::vecn::{dot, length, scale, sub};

/// Bytes of a brick and of a voxel.
pub(crate) const BRICK_BYTES: usize = 16;
pub(crate) const VOXEL_BYTES: usize = 16;

/// A brick of solid voxels: its corner in bricks, its mask and its voxels' ranks, in mask order.
#[derive(Clone)]
pub(super) struct Brick {
    pub at: Cell,
    pub mask: u64,
    pub voxels: Vec<usize>,
    pub joint: Option<u16>,
}

/// The bricks of `voxels`, in z, y, x order, each with the joint most of its voxels follow.
pub(super) fn bricks(voxels: &[Voxel]) -> Vec<Brick> {
    let brick_of = |v: &Voxel| v.cell.map(|c| c.div_euclid(4));
    let mut order: Vec<usize> = (0..voxels.len()).collect();
    order.sort_unstable_by_key(|&i| {
        let ([x, y, z], [lx, ly, lz]) = (
            brick_of(&voxels[i]),
            voxels[i].cell.map(|c| c.rem_euclid(4)),
        );
        (z, y, x, lz, ly, lx)
    });
    let mut out: Vec<Brick> = Vec::new();
    for i in order {
        let at = brick_of(&voxels[i]);
        if out.last().is_none_or(|b| b.at != at) {
            out.push(Brick {
                at,
                mask: 0,
                voxels: Vec::new(),
                joint: None,
            });
        }
        let brick = out.last_mut().expect("a brick was pushed");
        let [x, y, z] = voxels[i].cell.map(|c| c.rem_euclid(4) as u32);
        brick.mask |= 1 << (x + 4 * y + 16 * z);
        brick.voxels.push(i);
    }
    for brick in &mut out {
        brick.joint = most(brick.voxels.iter().filter_map(|&i| voxels[i].joint));
    }
    out
}

/// The value `values` hold most often, the smallest of a tie.
pub(super) fn most(values: impl Iterator<Item = u16>) -> Option<u16> {
    let mut values: Vec<u16> = values.collect();
    values.sort_unstable();
    let runs = values.chunk_by(|a, b| a == b);
    runs.rev().max_by_key(|run| run.len()).map(|run| run[0])
}

/// The bytes of a brick whose group's first brick is `first`.
pub(super) fn brick_record(brick: &Brick, first: Cell) -> [u8; BRICK_BYTES] {
    let mut out = [0; BRICK_BYTES];
    out[..8].copy_from_slice(&brick.mask.to_le_bytes());
    for k in 0..3 {
        let offset = (brick.at[k] - first[k]) as u16;
        out[8 + 2 * k..10 + 2 * k].copy_from_slice(&offset.to_le_bytes());
    }
    out[14..].copy_from_slice(&brick.joint.unwrap_or(u16::MAX).to_le_bytes());
    out
}

/// The bytes of a voxel of side `side`.
pub(super) fn voxel_record(voxel: &Voxel, side: f64) -> [u8; VOXEL_BYTES] {
    let m = &voxel.shown;
    let colour = m.colour.map(|c| linear_to_srgb((c / m.material) as f32));
    let orm = m.orm.map(|c| unit_to_byte(c / m.material));
    let mean = scale(m.normal, 1.0 / m.hits);
    let normal = normalized_or(mean, [0.0, 0.0, 1.0]);
    let open = (0..FACES).filter(|&f| voxel.closed >> f & 1 == 0 && voxel.faces[f].hits > 0.0);
    let dominant = open.max_by(|&f, &g| voxel.faces[f].hits.total_cmp(&voxel.faces[g].hits));
    let seen = dominant.map_or(m, |f| &voxel.faces[f]);
    let (contour, offset, thickness) = contour(voxel, seen, normal, side);
    let oct = |n: [f64; 3]| (oct_encode(n.map(|c| c as f32)) as u16).to_le_bytes();
    let half = 0.5 * 3.0_f64.sqrt();
    let mut out = [0; VOXEL_BYTES];
    out[..3].copy_from_slice(&colour);
    out[3] = unit_to_byte(length(mean).min(1.0));
    out[4..7].copy_from_slice(&orm);
    out[7] = unit_to_byte(voxel.coverage.min(1.0));
    out[8..10].copy_from_slice(&oct(normal));
    out[10..12].copy_from_slice(&oct(contour));
    out[12] = ((offset / half).clamp(-1.0, 1.0) * 127.0).round() as i8 as u8;
    out[13] = unit_to_byte((thickness / (2.0 * half)).clamp(0.0, 1.0));
    out[14..].copy_from_slice(&voxel.material.unwrap_or(u16::MAX).to_le_bytes());
    out
}

/// The contour of `voxel` through the hits `m`, in voxel sides: its normal, turned to `normal`,
/// its offset from the voxel's centre and its thickness.
fn contour(voxel: &Voxel, m: &Moments, normal: [f64; 3], side: f64) -> ([f64; 3], f64, f64) {
    let mean = scale(m.point, 1.0 / m.hits);
    let products = symmetric(m.spread, m.hits);
    let covariance: [[f64; 3]; 3] =
        std::array::from_fn(|i| std::array::from_fn(|j| products[i][j] - mean[i] * mean[j]));
    let along = |a: [f64; 3]| {
        let row = |i: usize| dot(covariance[i], a);
        (dot(a, [row(0), row(1), row(2)]) / (side * side)).max(0.0)
    };
    let mut axes = symmetric_axes(covariance).map(|a| (along(a), a));
    axes.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
    let [(least, axis), (middle, _), _] = axes;
    // Hits on a line or a point fit no plane: the mean normal stands for it.
    let flat = middle > 1e-6;
    let n = match (flat, dot(axis, normal) < 0.0) {
        (false, _) => normal,
        (true, true) => scale(axis, -1.0),
        (true, false) => axis,
    };
    let least = if flat { least } else { along(n) };
    let centre = voxel.cell.map(|c| (f64::from(c) + 0.5) * side);
    let offset = dot(n, sub(mean, centre)) / side;
    let half = (3.0 * least).sqrt();
    // Behind the surface, along its normal's largest axis: face `2a` opens on the voxel before.
    let a = dominant_axis(n);
    let behind = 2 * a + usize::from(n[a] < 0.0);
    if voxel.closed >> behind & 1 == 1 {
        let (front, back) = (offset + half, -0.5 * (n[0].abs() + n[1].abs() + n[2].abs()));
        return (n, 0.5 * (front + back), front - back);
    }
    (n, offset, 2.0 * half)
}
