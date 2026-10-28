//! Where a mesh's field sits in space: its box, how many bricks it holds along each axis at each
//! mip, the band it stores and how a point of the mesh's volume finds its voxel. Lengths are the
//! reference's units (centimetres).
use super::abi::{
    DISTANCE_FIELD_BAND_VOXELS, DISTANCE_FIELD_MAX_INDIRECTION, DISTANCE_FIELD_MIPS,
    DISTANCE_FIELD_OBJECT_BORDER, DISTANCE_FIELD_UNIQUE_BRICK,
};
use super::DistanceFieldSettings;

type Vec3 = [f64; 3];

/// The most a box's half-extent may fall to: a plane still has a box.
const LEAST_HALF_EXTENT: f64 = 1.0;
/// How far, in voxels, a mostly two-sided mesh's box grows, as the reference writes it: the
/// quarter of a voxel it names is a whole number of voxels in the divisor it is subtracted from,
/// which is 0.
const CENTRAL_DIFFERENCING_VOXELS: i64 = 0;

/// The box of the mesh and the bricks of its mip 0.
pub(super) struct Grid {
    /// The field's box: the mesh's box made at least a unit of half-extent, grown by a texel for a
    /// mesh mostly two-sided.
    pub low: Vec3,
    pub high: Vec3,
    /// The bricks along each axis at mip 0.
    pub bricks: [usize; 3],
    /// The tracing volume's scale: one over the box's largest half-extent.
    pub to_volume: f64,
}

/// `value` rounded to the nearest whole number, halves up.
fn round(value: f64) -> i64 {
    (value + 0.5).floor() as i64
}

/// The size of a box, per axis.
fn size(low: Vec3, high: Vec3) -> Vec3 {
    [0, 1, 2].map(|k| high[k] - low[k])
}

/// The box `low, high` made at least a unit of half-extent an axis about its centre.
fn at_least_a_unit(low: Vec3, high: Vec3) -> (Vec3, Vec3) {
    let centre = [0, 1, 2].map(|k| 0.5 * (low[k] + high[k]));
    let half = [0, 1, 2].map(|k| (0.5 * (high[k] - low[k])).max(LEAST_HALF_EXTENT));
    (
        [0, 1, 2].map(|k| centre[k] - half[k]),
        [0, 1, 2].map(|k| centre[k] + half[k]),
    )
}

/// The most bricks along an axis at mip 0 that the resolution allows — half of it for a scale of at
/// most 1 —, at least 1.
pub(super) fn most_bricks(settings: &DistanceFieldSettings) -> usize {
    let resolution = f64::from(settings.max_resolution);
    let allowed = match settings.scale <= 1.0 {
        true => (resolution / 2.0).floor(),
        false => resolution,
    };
    let most = round_nearest(allowed as i64, DISTANCE_FIELD_UNIQUE_BRICK as i64)
        .min(DISTANCE_FIELD_MAX_INDIRECTION as i64 - 1);
    most.max(1) as usize
}

/// The bricks along each axis at mip 0 of a box of `size`: its voxels at the density the scale
/// gives, in bricks, rounded and held between 1 and the most the resolution allows.
fn mip0_bricks(size: Vec3, settings: &DistanceFieldSettings) -> [usize; 3] {
    let unique = DISTANCE_FIELD_UNIQUE_BRICK as f64;
    let most = most_bricks(settings) as i64;
    let per_unit = settings.density * settings.scale;
    size.map(|s| round(s * per_unit / unique).clamp(1, most) as usize)
}

/// The voxels the mips of a field at `settings` hold at most: of a mesh whose box is `bounds`
/// (centimetres), each mip's bricks whole and one more along every axis — a box read in another
/// precision may round a side to the next brick —, one-sided or two-sided, whichever holds more;
/// of any mesh, each mip's most bricks along every axis (`most_bricks`, halved a mip), when its box
/// is not known.
pub(super) fn bound_voxels(
    bounds: Option<(Vec3, Vec3)>,
    settings: &DistanceFieldSettings,
) -> usize {
    let bricks = |grid: Grid| -> usize {
        (0..DISTANCE_FIELD_MIPS)
            .map(|mip| {
                grid.mip(mip)
                    .bricks
                    .iter()
                    .map(|b| b + 1)
                    .product::<usize>()
            })
            .sum()
    };
    let most = most_bricks(settings);
    let any = (0..DISTANCE_FIELD_MIPS)
        .map(|mip| most.div_ceil(1 << mip).pow(3))
        .sum();
    let held = match bounds {
        Some((low, high)) => [false, true]
            .map(|two_sided| bricks(Grid::of(low, high, settings, two_sided)))
            .into_iter()
            .max()
            .unwrap_or(any),
        None => any,
    };
    held * super::brick::BRICK_VOXELS
}

/// `a / b` rounded to the nearest whole number, for `b` positive.
fn round_nearest(a: i64, b: i64) -> i64 {
    match a > 0 {
        true => (a + b / 2) / b,
        false => (a - b / 2) / b,
    }
}

impl Grid {
    /// The grid of a mesh whose box is `low, high` (centimetres), `two_sided` when it is mostly so.
    pub(super) fn of(
        low: Vec3,
        high: Vec3,
        settings: &DistanceFieldSettings,
        two_sided: bool,
    ) -> Self {
        let (mut low, mut high) = at_least_a_unit(low, high);
        if two_sided {
            let bricks = mip0_bricks(size(low, high), settings);
            let voxels = bricks
                .map(|b| (b * DISTANCE_FIELD_UNIQUE_BRICK) as i64 - CENTRAL_DIFFERENCING_VOXELS);
            let texel = [0, 1, 2].map(|k| (high[k] - low[k]) / voxels[k] as f64);
            (low, high) = (
                [0, 1, 2].map(|k| low[k] - texel[k]),
                [0, 1, 2].map(|k| high[k] + texel[k]),
            );
        }
        let half_max = (0..3).map(|k| 0.5 * (high[k] - low[k])).fold(0.0, f64::max);
        Self {
            low,
            high,
            bricks: mip0_bricks(size(low, high), settings),
            to_volume: 1.0 / half_max,
        }
    }

    /// Mip `mip`'s placement.
    pub(super) fn mip(&self, mip: usize) -> MipGrid {
        let unique = DISTANCE_FIELD_UNIQUE_BRICK;
        let bricks = self.bricks.map(|b| b.div_ceil(1 << mip));
        let voxels = bricks.map(|b| (b * unique) as f64);
        let border = 2.0 * DISTANCE_FIELD_OBJECT_BORDER as f64;
        // One voxel of border all round the box, for the gradient the filter reconstructs.
        let texel = [0, 1, 2].map(|k| (self.high[k] - self.low[k]) / (voxels[k] - border));
        let low = [0, 1, 2].map(|k| self.low[k] - texel[k]);
        let high = [0, 1, 2].map(|k| self.high[k] + texel[k]);
        let brick_size = [0, 1, 2].map(|k| (high[k] - low[k]) / bricks[k] as f64);
        let voxel_volume = [0, 1, 2].map(|k| brick_size[k] * self.to_volume / unique as f64);
        let band =
            DISTANCE_FIELD_BAND_VOXELS * voxel_volume.iter().map(|v| v * v).sum::<f64>().sqrt();
        let extent = [0, 1, 2].map(|k| 0.5 * (self.high[k] - self.low[k]) * self.to_volume);
        let uv_min = [0, 1, 2].map(|k| DISTANCE_FIELD_OBJECT_BORDER as f64 / voxels[k]);
        let uv_size = [0, 1, 2].map(|k| (voxels[k] - border) / voxels[k]);
        let uv_scale = [0, 1, 2].map(|k| uv_size[k] / (2.0 * extent[k]));
        MipGrid {
            bricks,
            low,
            brick_size,
            band,
            trace_distance: band / self.to_volume,
            to_volume: self.to_volume,
            uv_scale,
            uv_add: [0, 1, 2].map(|k| extent[k] * uv_scale[k] + uv_min[k]),
        }
    }
}

/// One mip's bricks and the volume they span.
pub(super) struct MipGrid {
    /// The bricks along each axis.
    pub bricks: [usize; 3],
    /// The corner of the volume the bricks span, which is the field's box and a voxel's border.
    pub low: Vec3,
    /// The size of a brick, per axis.
    pub brick_size: Vec3,
    /// The largest distance the voxels store, in the tracing volume's units.
    pub band: f64,
    /// The same, in the mesh's own units: how far a voxel looks for a surface.
    pub trace_distance: f64,
    /// The tracing volume's scale (`Grid::to_volume`).
    pub to_volume: f64,
    /// `[-extent, extent]` of the tracing volume to the virtual texture coordinate, scale and add.
    pub uv_scale: Vec3,
    pub uv_add: Vec3,
}

impl MipGrid {
    /// How many bricks the mip holds, cell after cell.
    pub(super) fn cells(&self) -> usize {
        self.bricks.iter().product()
    }

    /// The box the bricks span.
    pub(super) fn volume(&self) -> (Vec3, Vec3) {
        let high = [0, 1, 2].map(|k| self.low[k] + self.brick_size[k] * self.bricks[k] as f64);
        (self.low, high)
    }

    /// The distance scale and bias: the stored byte's range, `[-band, band]`, in the tracing
    /// volume's units.
    pub(super) fn scale_bias(&self) -> [f64; 2] {
        [2.0 * self.band, -self.band]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bricks of a mesh a thousand units across, of scale 1, at the density `density`.
    fn bricks(density: f64) -> [usize; 3] {
        let settings = DistanceFieldSettings {
            density,
            ..DistanceFieldSettings::default()
        };
        mip0_bricks([1000.0; 3], &settings)
    }

    #[test]
    fn any_density_builds_a_field_held_between_one_brick_and_the_resolution_allowed() {
        // A scale of 1 holds half of 256 voxels, in bricks of 7: 18.
        assert_eq!(bricks(0.2), [18; 3]);
        assert_eq!(bricks(0.5), [18; 3]);
        assert_eq!(bricks(1.0e300), [18; 3]);
        assert_eq!(bricks(0.01), [1; 3]);
        assert_eq!(bricks(0.0), [1; 3]);
        assert_eq!(bricks(-3.0), [1; 3]);
    }
}
