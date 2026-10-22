//! The grid every page of a primitive shares, written once for both cuts: the compiler's
//! (`geometry_page::quant::page_grid`) and the one the engine runs on drawn triangles
//! (`packages/sdk-browser/src/geometry/runtime/runtimeCut.ts`), through the SDK module
//! (`wasm/grid.rs`). The position precision follows how fine the primitive's clusters are, as a
//! mesh build sets it; the normals' and tangents' are the mesh's, or the format's.

use super::quant::rounded_cell;
use super::{pow2, PositionGrid};
use crate::{
    AUTO_MIN_POSITION_PRECISION, CENTIMETRES_PER_METRE, DEFAULT_NORMAL_PRECISION,
    DEFAULT_TANGENT_PRECISION, MAX_NORMAL_PRECISION, MAX_POSITION_BITS, MAX_POSITION_PRECISION,
    MAX_TANGENT_PRECISION, MIN_POSITION_PRECISION,
};

/// The least `f32` an `i32` holds, and the greatest at or under `i32::MAX`.
const CELL_MIN: f32 = -2_147_483_648.0;
const CELL_MAX: f32 = 2_147_483_520.0;
/// The most cells an axis of one page spans above its start.
const MAX_SPAN: i64 = (1 << MAX_POSITION_BITS) - 1;
/// The factor of a natural logarithm to a base-2 one, in `f32`.
const LOG_TO_LOG2: f32 = std::f32::consts::LOG2_E;

/// The box of one cluster of a primitive, in metres of its own space: the clusters of the finest
/// level (`finest`) set the position precision, every one must fit it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Extent {
    pub low: [f32; 3],
    pub high: [f32; 3],
    pub finest: bool,
}

impl Extent {
    /// Half the length of the box's diagonal, in centimetres.
    fn size(&self) -> f32 {
        let half = |c: usize| {
            let centimetres = CENTIMETRES_PER_METRE as f32;
            (self.high[c] * centimetres - self.low[c] * centimetres) * 0.5
        };
        (half(0) * half(0) + half(1) * half(1) + half(2) * half(2)).sqrt()
    }
}

/// The precisions a mesh build names, each none where it names none: the position grid's, as the
/// whole number `n` of its step `2^-n` centimetre; the normals', in bits an axis; and the stored
/// tangents' angle's, in bits. A negative normal or tangent precision is none.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Precision {
    pub position: Option<i32>,
    pub normal: Option<i32>,
    pub tangent: Option<i32>,
}

impl Precision {
    /// Bits an axis of a normal, from 1 to `MAX_NORMAL_PRECISION`: a normal of no bits has no cell
    /// to decode. `DEFAULT_NORMAL_PRECISION` where none is named.
    pub fn normal_bits(&self) -> u32 {
        named(
            self.normal,
            DEFAULT_NORMAL_PRECISION,
            (1, MAX_NORMAL_PRECISION),
        )
    }

    /// Bits of a stored tangent's angle, from 0 to `MAX_TANGENT_PRECISION`.
    /// `DEFAULT_TANGENT_PRECISION` where none is named.
    pub fn tangent_bits(&self) -> u32 {
        named(
            self.tangent,
            DEFAULT_TANGENT_PRECISION,
            (0, MAX_TANGENT_PRECISION),
        )
    }
}

/// `bits` held within `limits`, or `default` where none, or a negative, is named.
fn named(bits: Option<i32>, default: u32, (low, high): (u32, u32)) -> u32 {
    match bits {
        Some(bits) if bits >= 0 => (bits as u32).clamp(low, high),
        _ => default,
    }
}

/// What every page of a primitive is quantized with: the position grid's precision, the normals'
/// bits an axis and the tangents' angle bits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PageGrid {
    pub position: i32,
    pub normal: u32,
    pub tangent: u32,
}

impl PageGrid {
    /// The grid on position precision `position`, the normals and the tangents at the format's.
    pub fn at(position: i32) -> Self {
        Self {
            position,
            normal: DEFAULT_NORMAL_PRECISION,
            tangent: DEFAULT_TANGENT_PRECISION,
        }
    }

    /// The positions `positions` (three floats a vertex, in metres) decode to on this grid: each
    /// the float a reader of any page holding it draws (`PositionGrid::metres`), whatever the
    /// cluster — a vertex is one cell in every page that has it. What a box bounding a page is
    /// measured over, so that it holds every vertex the page decodes to.
    pub fn decoded(&self, positions: &[f32]) -> Vec<f32> {
        let scale = pow2(self.position);
        let unit = PositionGrid::flat(self.position).unit();
        positions
            .iter()
            .map(|&metres| (rounded_cell(metres, scale) as i32) as f32 * unit)
            .collect()
    }

    /// The grid of a primitive's pages: the position precision `precision` names, or the one the
    /// primitive's `extents` set (`automatic`), held to the format's bounds, then lowered until
    /// every cluster's box spans at most `MAX_POSITION_BITS` cells an axis. Every page rounds
    /// absolute coordinates on it, so a vertex two clusters share lands on one cell. `None` when
    /// a cluster is too wide for the coarsest precision.
    pub fn of(precision: Precision, extents: &[Extent]) -> Option<Self> {
        let mut position = match precision.position {
            Some(fixed) => fixed,
            None => automatic(extents).max(AUTO_MIN_POSITION_PRECISION),
        }
        .clamp(MIN_POSITION_PRECISION, MAX_POSITION_PRECISION);
        for extent in extents {
            while !fits(extent, pow2(position)) {
                position -= 1;
                if position < MIN_POSITION_PRECISION {
                    return None;
                }
            }
        }
        Some(Self {
            position,
            normal: precision.normal_bits(),
            tangent: precision.tangent_bits(),
        })
    }
}

/// Whether a cluster's box falls on `scale` (`2^precision`) cells that an `i32` holds and that
/// span at most `MAX_POSITION_BITS` bits an axis.
fn fits(extent: &Extent, scale: f32) -> bool {
    (0..3).all(|c| {
        let low = rounded_cell(extent.low[c], scale);
        let high = rounded_cell(extent.high[c], scale);
        low >= CELL_MIN && high <= CELL_MAX && (high as i64 - low as i64) <= MAX_SPAN
    })
}

/// The precision a primitive's clusters call for: seven less the mean of the base-2 logarithms of
/// the finest clusters' half-diagonals in centimetres, rounded — a denser mesh gets a finer grid.
/// A cluster of no extent counts for nothing; no finest cluster, a mean of zero.
fn automatic(extents: &[Extent]) -> i32 {
    let sizes = (extents.iter())
        .filter(|extent| extent.finest)
        .map(Extent::size)
        .filter(|&size| size > 0.0);
    let (total, count) = sizes.fold((0.0f64, 0u32), |(total, count), size| {
        (total + f64::from(libm::logf(size) * LOG_TO_LOG2), count + 1)
    });
    let mean = if count > 0 {
        total / f64::from(count)
    } else {
        0.0
    };
    7 - (mean + 0.5).floor() as i32
}
