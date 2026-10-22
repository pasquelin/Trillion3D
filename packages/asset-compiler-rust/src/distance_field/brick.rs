//! One brick of a field: 8³ voxels, each the signed distance to the mesh's surface held to the
//! band and quantised to a byte, 0 for the farthest inside and 255 for the farthest outside.
use super::abi::{DISTANCE_FIELD_BRICK, DISTANCE_FIELD_UNIQUE_BRICK};
use super::grid::MipGrid;
use super::scene::Scene;

/// The voxels of a brick.
pub(super) const BRICK_VOXELS: usize =
    DISTANCE_FIELD_BRICK * DISTANCE_FIELD_BRICK * DISTANCE_FIELD_BRICK;

/// A brick's voxels, in `z`, `y`, `x` order, and the least and the greatest byte among them.
pub(super) struct Brick {
    pub voxels: Vec<u8>,
    pub least: u8,
    pub greatest: u8,
}

impl Brick {
    /// Whether the brick holds a surface's band: not all its voxels are the farthest inside or the
    /// farthest outside. Only such a brick is stored.
    pub(super) fn stored(&self) -> bool {
        self.least < u8::MAX && self.greatest > 0
    }
}

/// The brick at cell `at` of mip grid `mip`, its voxels measured against `scene` along
/// `directions`.
pub(super) fn brick(
    scene: &Scene,
    mip: &MipGrid,
    directions: &[[f64; 3]],
    at: [usize; 3],
) -> Brick {
    let unique = DISTANCE_FIELD_UNIQUE_BRICK as f64;
    let volume = mip.volume();
    let voxel = mip.brick_size.map(|s| s / unique);
    let corner = [0, 1, 2].map(|k| mip.low[k] + at[k] as f64 * mip.brick_size[k]);
    let [scale, bias] = mip.scale_bias();
    let mut voxels = Vec::with_capacity(BRICK_VOXELS);
    for z in 0..DISTANCE_FIELD_BRICK {
        for y in 0..DISTANCE_FIELD_BRICK {
            for x in 0..DISTANCE_FIELD_BRICK {
                let position = [0, 1, 2].map(|k| [x, y, z][k] as f64 * voxel[k] + corner[k]);
                let distance =
                    scene.signed_distance(position, mip.trace_distance, (directions, volume));
                // The tracing volume's units, then the stored range's, then the byte.
                let rescaled = (distance * mip.to_volume - bias) / scale;
                voxels.push((rescaled * 255.0 + 0.5).floor().clamp(0.0, 255.0) as u8);
            }
        }
    }
    let least = voxels.iter().copied().min().unwrap_or(u8::MAX);
    let greatest = voxels.iter().copied().max().unwrap_or(0);
    Brick {
        voxels,
        least,
        greatest,
    }
}
