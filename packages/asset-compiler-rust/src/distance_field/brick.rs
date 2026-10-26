//! One brick of a field: 8³ voxels, each the signed distance to the mesh's surface held to the
//! band and quantised to a byte, 0 for the farthest inside and 255 for the farthest outside.
use super::abi::{DISTANCE_FIELD_BRICK, DISTANCE_FIELD_UNIQUE_BRICK};
use super::grid::MipGrid;
use super::scene::Scene;

type Vec3 = [f64; 3];

/// The voxels of a brick.
pub(super) const BRICK_VOXELS: usize =
    DISTANCE_FIELD_BRICK * DISTANCE_FIELD_BRICK * DISTANCE_FIELD_BRICK;

/// A brick's voxels, in `z`, `y`, `x` order, and the least and the greatest byte among them.
#[derive(Clone)]
pub(super) struct Brick {
    pub voxels: Vec<u8>,
    pub least: u8,
    pub greatest: u8,
}

impl Brick {
    /// The brick of `voxels`, in `z`, `y`, `x` order.
    pub(super) fn of(voxels: Vec<u8>) -> Self {
        let least = voxels.iter().copied().min().unwrap_or(u8::MAX);
        let greatest = voxels.iter().copied().max().unwrap_or(0);
        Self {
            voxels,
            least,
            greatest,
        }
    }

    /// The brick whose voxels are all the band's far end: one past every triangle's band.
    pub(super) fn clear(mip: &MipGrid) -> Self {
        Self::of(vec![quantise(mip, mip.trace_distance); BRICK_VOXELS])
    }

    /// Whether the brick holds a surface's band: not all its voxels are the farthest inside or the
    /// farthest outside. Only such a brick is stored.
    pub(super) fn stored(&self) -> bool {
        self.least < u8::MAX && self.greatest > 0
    }
}

/// The byte of a signed `distance` (the mesh's units) held to `mip`'s band: its tracing volume's
/// units, then the stored range's, then the byte.
pub(super) fn quantise(mip: &MipGrid, distance: f64) -> u8 {
    let [scale, bias] = mip.scale_bias();
    let rescaled = (distance * mip.to_volume - bias) / scale;
    (rescaled * 255.0 + 0.5).floor().clamp(0.0, 255.0) as u8
}

/// Where the voxels of one brick lie.
pub(super) struct Frame {
    corner: Vec3,
    voxel: Vec3,
}

impl Frame {
    /// The frame of the brick at cell `at` of mip grid `mip`.
    pub(super) fn of(mip: &MipGrid, at: [usize; 3]) -> Self {
        let unique = DISTANCE_FIELD_UNIQUE_BRICK as f64;
        Self {
            corner: [0, 1, 2].map(|k| mip.low[k] + at[k] as f64 * mip.brick_size[k]),
            voxel: mip.brick_size.map(|s| s / unique),
        }
    }

    /// The position of the brick's voxel of rank `index`, `x` fastest, then `y`, then `z`.
    pub(super) fn voxel(&self, index: usize) -> Vec3 {
        let side = DISTANCE_FIELD_BRICK;
        let at = [index % side, (index / side) % side, index / (side * side)];
        [0, 1, 2].map(|k| at[k] as f64 * self.voxel[k] + self.corner[k])
    }

    /// Whether a triangle of `scene` lies where a voxel of the brick can find one: within the trace
    /// distance and the voxels' half diagonal of their centre, a billionth more. A brick none
    /// reaches is the band's far end all through, its voxels not measured one by one.
    pub(super) fn reached(&self, mip: &MipGrid, scene: &Scene) -> bool {
        let last = (DISTANCE_FIELD_BRICK - 1) as f64;
        let centre = [0, 1, 2].map(|k| self.corner[k] + 0.5 * last * self.voxel[k]);
        let half_diagonal = 0.5 * last * self.voxel.iter().map(|v| v * v).sum::<f64>().sqrt();
        scene.reaches(centre, (mip.trace_distance + half_diagonal) * (1.0 + 1e-9))
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
    let volume = mip.volume();
    let frame = Frame::of(mip, at);
    if !frame.reached(mip, scene) {
        return Brick::clear(mip);
    }
    let voxels = (0..BRICK_VOXELS).map(|index| {
        let distance =
            scene.signed_distance(frame.voxel(index), mip.trace_distance, (directions, volume));
        quantise(mip, distance)
    });
    Brick::of(voxels.collect())
}
