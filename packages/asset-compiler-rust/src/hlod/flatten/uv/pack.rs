//! The islands packed into the unit square by a raster packer: each island is rasterized into
//! texels and slid over the free texel runs of the square until it lands on none in use. The
//! islands keep their relative scale and are never mirrored — a flip would turn the baked
//! texture's handedness — but may turn by quarter turns, which costs nothing:
//!
//! - `find_best`: the scale searched linearly by halves from where the islands would fill half the
//!   square, then by six bisections, stopping within a percent of efficiency;
//! - `scale_charts`: every island at the scale, those too long for the square shrunk to it and the
//!   others grown to keep the total area, then sorted largest box first;
//! - `pack`: each island tried in its four rotations, rasterized with a one-pixel dilation so
//!   neighbours never share a texel (`rasterize`, `rasterize_triangle`), placed by the segment
//!   search (`Layout::find`) where its right plus its top is least, keeping the square's corner
//!   filled first.
//!
//! The raster lives in `raster`, the layout in `layout`, the packer in `packer`, what it shares
//! with the old layout's packer in `search`.
use trillion3d_math::geometry::aabb::aabb_of;
use trillion3d_math::vector::vec2::double_area;
mod layout;
mod packer;
mod raster;
mod search;
pub(crate) use layout::Layout;
use packer::{Chart, Packer};
pub(crate) use raster::Raster;
pub(crate) use search::{best_placement, covering, rebalance, search_scale, Starts};

/// A segment of a run: its start and length.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Segment {
    start: u32,
    length: u32,
}

/// A row's or a column's segments, the longest, and in free mode the lookup from a
/// position to the first free segment of the search.
#[derive(Clone, Default)]
struct Run {
    longest: u32,
    segments: Vec<Segment>,
    lookup: Vec<u16>,
}

/// A chart's placement in the square, in texels.
#[derive(Clone, Copy)]
pub(crate) struct Rect {
    pub(crate) x: u32,
    pub(crate) y: u32,
    pub(crate) w: u32,
    pub(crate) h: u32,
}

/// `corners`, per corner of the triangles, packed by `islands` into `[0, 1]²` for a `resolution`
/// texel square, the resolution held between 2 and 16384. Left as they are when the packer finds
/// no layout: more charts than texels — it needs one texel a chart at least — or islands of no
/// area; the caller goes on with them.
pub(crate) fn pack(corners: &mut [[f64; 2]], islands: &[Vec<usize>], resolution: u32) {
    let resolution = resolution.clamp(2, 16384);
    let mut charts: Vec<Chart> = (islands.iter().enumerate())
        .map(|(id, island)| {
            let local: Vec<[f64; 2]> = (island.iter())
                .flat_map(|&t| corners[t * 3..t * 3 + 3].iter().copied())
                .collect();
            let (min, max) = aabb_of(local.iter().copied());
            let area = (local.as_chunks::<3>().0.iter())
                .map(|t| 0.5 * double_area(t[0], t[1], t[2]).abs())
                .sum();
            Chart {
                id,
                corners: local,
                min,
                max,
                area,
                scale: 0.0,
                rotation: [[1.0, 0.0], [0.0, 1.0]],
                shift: [0.0; 2],
                bias: [0.0; 2],
            }
        })
        .collect();
    let total_area: f64 = charts.iter().map(|c| c.area).sum();
    if charts.len() as u64 > resolution as u64 * resolution as u64 || total_area <= 0.0 {
        return;
    }
    let packer = Packer {
        resolution,
        total_area,
    };
    packer.find_best(&mut charts);
    // Commit: each corner by its chart's rotation and scale, then its bias, over the resolution.
    let res = resolution as f64;
    for chart in &charts {
        let island = &islands[chart.id];
        for (k, &t) in island.iter().enumerate() {
            for c in 0..3 {
                let p = chart.place(chart.corners[k * 3 + c]);
                corners[t * 3 + c] = [p[0] / res, p[1] / res];
            }
        }
    }
}
