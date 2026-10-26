//! Solid voxels packed in 4³ bricks, and the bytes of a brick and of a voxel.
//!
//! A brick: its voxel mask (`u64`, bit `x + 4y + 16z`), its corner in bricks from its group's
//! first (`u16` × 3) and its joint (`u16`, `0xFFFF` for none): 16 bytes, the first four words of a
//! page's brick record as they are. Its voxels follow the mask's bits, 12 bytes each — a group's
//! voxels in its bricks' order, so a brick's first is the group's first plus the popcounts of the
//! masks before it —, what the runtime reads of a voxel and nothing else:
//!
//! | bytes | content |
//! |---|---|
//! | 0–3 | base colour, sRGB; zero |
//! | 4–7 | occlusion, roughness, metallic; zero |
//! | 8–9 | normal, octahedral (`oct_encode`): the axis of the fitted normal distribution (`voxelNdf`, `ndf.rs`), else the direction of the mean normal |
//! | 10 | the ratio of the fitted distribution's two widths (`voxelNdf`), from which the resolve draws each pixel's shading normal, else zero |
//! | 11 | zero |
use super::ndf::fitted;
use super::raster::Cell;
use super::solid::Voxel;
use super::VoxelSettings;
use crate::texture::linear_to_srgb;
use trillion3d_math::scalar::unit_to_byte;
use trillion3d_math::vector::octahedral::oct_encode;
use trillion3d_math::vector::vec3::normalized_or;
use trillion3d_math::vector::vecn::scale;

/// Bytes of a brick and of a voxel.
pub(crate) const BRICK_BYTES: usize = 16;
pub(crate) const VOXEL_BYTES: usize = 12;

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

/// The bytes of a voxel sampled as `settings` say: its normals' distribution fitted or dropped to
/// the direction of their mean.
pub(super) fn voxel_record(voxel: &Voxel, settings: &VoxelSettings) -> [u8; VOXEL_BYTES] {
    let m = &voxel.shown;
    let colour = m.colour.map(|c| linear_to_srgb((c / m.covered) as f32));
    let orm = m.orm.map(|c| unit_to_byte(c / m.covered));
    let mean = scale(m.normal, 1.0 / m.hits);
    let (normal, ratio) = match settings.ndf {
        true => fitted(m.ndf),
        false => (normalized_or(mean, [0.0, 0.0, 1.0]), 0.0),
    };
    let oct = |n: [f64; 3]| (oct_encode(n.map(|c| c as f32)) as u16).to_le_bytes();
    let mut out = [0; VOXEL_BYTES];
    out[..3].copy_from_slice(&colour);
    out[4..7].copy_from_slice(&orm);
    out[8..10].copy_from_slice(&oct(normal));
    out[10] = unit_to_byte(ratio);
    out
}

#[cfg(test)]
mod tests {
    use super::super::sample::{Moments, FACES};
    use super::*;

    /// A voxel whose normals' products sum to `ndf` over `hits` hits, their sum `normal`.
    fn voxel(ndf: [f64; 6], normal: [f64; 3], hits: f64) -> Voxel {
        let shown = Moments {
            covered: 1.0,
            normal,
            ndf,
            hits,
            ..Moments::default()
        };
        Voxel {
            cell: [0; 3],
            coverage: 1.0,
            faces: [Moments::default(); FACES],
            shown,
            joint: None,
        }
    }

    fn oct(n: [f64; 3]) -> [u8; 2] {
        (oct_encode(n.map(|c| c as f32)) as u16).to_le_bytes()
    }

    // Behaviour: a wall facing y, its normals fitted, is a normal along y — either way, the
    // distribution having no side — and a ratio of 0, a mirror; its record without the fit keeps
    // the mean's direction and no ratio; a sphere of normals fitted has the ratio of one half.
    // Neither carries a spread of the normals: byte 3 is zero.
    #[test]
    fn a_voxel_record_keeps_the_fitted_normal_and_its_ratio() {
        let wall = voxel([0.0, 2.0, 0.0, 0.0, 0.0, 0.0], [0.0, 2.0, 0.0], 2.0);
        let axis = voxel_record(&wall, &VoxelSettings::default());
        assert!([oct([0.0, 1.0, 0.0]), oct([0.0, -1.0, 0.0])].contains(&[axis[8], axis[9]]));
        assert_eq!((axis[3], axis[10]), (0, 0));
        let plain = VoxelSettings {
            ndf: false,
            ..VoxelSettings::default()
        };
        let mean = voxel_record(&wall, &plain);
        assert_eq!([mean[8], mean[9]], oct([0.0, 1.0, 0.0]));
        assert_eq!((mean[3], mean[10]), (0, 0));
        let sphere = voxel([1.0, 1.0, 1.0, 0.0, 0.0, 0.0], [0.0; 3], 3.0);
        let round = voxel_record(&sphere, &VoxelSettings::default());
        assert_eq!(round[10], unit_to_byte(0.5));
    }
}
