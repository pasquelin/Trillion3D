//! The simplify builder's reduction of its iso-surface by edge collapse on quadric error (Garland
//! & Heckbert 1997), the normal priced as three attributes (Hoppe 1999) and the enclosed volume
//! kept (Lindstrom & Turk 1998). The target reads the source: a pixel of the screen size spans the
//! source bounds' diagonal over the pixels, a collapse may cost up to that span cubed times 170 —
//! the cost of taking a vertex off a cube of that side —, and the triangles stay at or above
//! `retained` of the source's polygon count.
//!
//! Serially, one pass collapses until the mesh is under the source's polygon count and either
//! under that floor or past that cost. In parallel, waves cut the mesh across its source bounds'
//! major axis into 31 slabs, then 7 — a wave only where the mesh has ten thousand triangles a slab,
//! the primes keeping the cuts of two waves apart —, simplify each slab apart to the wave's share
//! of its own triangles with the edges on its cuts locked, and weld the slabs back (`waves`,
//! `split`); a last pass over the whole mesh closes on the floor. The waves' shares are equal, so
//! that the waves and the last pass, each keeping that share, keep the floor's share between them.
//!
//! The collapses live in `collapser`, their quadrics in `quadric` and `optimum`, the tables they
//! search in `chains`, the roundings of counts and slabs in `rounding`. Every step runs in the
//! order it is written in, one slab of a wave on each thread, every float in the precision it is
//! declared in: the mesh in single precision, the quadrics in double.
use trillion3d_math::vector::vecn::{squared_length, sub};

mod chains;
mod collapser;
mod optimum;
mod quadric;
mod rounding;
mod split;
mod waves;

/// A vertex of the mesh the simplifier reads and writes: its position and normal, single precision.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
}

/// The mesh: its vertices and its triangles, three indices each.
pub(crate) struct Soup {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
}

/// The bounds of the source geometry (low and high corners) and its polygon count, which the
/// target reads.
pub(crate) struct Reference {
    pub low: [f32; 3],
    pub high: [f32; 3],
    pub polygons: usize,
}

/// The cost of taking a vertex off a cube one pixel's span a side, per span cubed.
const CUBE_COST: f32 = 170.0;

/// Where a simplification stops: below `least` triangles or before a collapse dearer than
/// `max_cost`, and, when `most` is set, only once below `most` triangles as well.
struct Stop {
    least: i32,
    most: Option<i32>,
    max_cost: f32,
}

impl Stop {
    /// Whether a mesh of `triangles` stops before the collapse of `cost` on top of its heap.
    fn reached(&self, triangles: i32, cost: f32) -> bool {
        let past = triangles < self.least || cost > self.max_cost;
        past && self.most.is_none_or(|most| triangles < most)
    }
}

/// `mesh` replaced by its simplification for `pixels` (the screen size in pixels) keeping at least
/// `retained` (0.002 in our use) of the reference's polygons, the single pass when `serial`, the
/// waves of slabs otherwise.
///
/// The bounds' diagonal is the length of their extents, its squares summed in single precision
/// and its root taken in double; the serial pass's floor is `retained` of the polygon count
/// rounded up, the count read as a 32-bit integer.
pub(crate) fn reduce(
    mesh: &mut Soup,
    reference: &Reference,
    (pixels, retained): (i32, f32),
    serial: bool,
) {
    let diagonal = f64::from(squared_length(sub(reference.high, reference.low))).sqrt() as f32;
    let span = diagonal / pixels as f32;
    let max_cost = span * span * span * CUBE_COST;
    if serial {
        let most = reference.polygons as i32;
        let least = rounding::ceil_i32(most as f32 * retained);
        let stop = Stop {
            least,
            most: Some(most),
            max_cost,
        };
        collapser::simplify(mesh, &stop, None);
    } else {
        waves::reduce_in_waves(mesh, reference, retained, max_cost);
    }
}
