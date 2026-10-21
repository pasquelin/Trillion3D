//! The crossing test of a set of boundary edges in the plane, which every validity check of the
//! builder runs: whether a segment, or an edge of the set or of a given list, crosses an edge of
//! the set strictly inside both (`segments_cross`).
//!
//! Up to twenty edges are tested pair by pair. Past that the edges are first sorted into a uniform
//! grid on the first test, which a test then walks along its own segment (`cells.rs`). The
//! positions are read at each test, so a vertex moved since the grid was built is tested where it
//! now is, in the cells its edges were first listed in.
use super::mesh::{edge_end, NONE};
use super::vector::{least2, most2, segments_cross, Vec2};

mod cells;

/// Where the grid reads an edge's ends.
#[derive(Clone, Copy)]
pub(super) enum Corners<'a> {
    /// A position per corner.
    PerCorner(&'a [Vec2]),
    /// The positions, and per corner its position's index.
    Indexed {
        positions: &'a [Vec2],
        indices: &'a [usize],
    },
}

impl Corners<'_> {
    /// The index of a corner's position.
    #[inline]
    fn vertex(&self, corner: usize) -> usize {
        match self {
            Corners::PerCorner(_) => corner,
            Corners::Indexed { indices, .. } => indices[corner],
        }
    }

    #[inline]
    fn position(&self, vertex: usize) -> Vec2 {
        match self {
            Corners::PerCorner(positions) | Corners::Indexed { positions, .. } => positions[vertex],
        }
    }

    #[inline]
    fn start(&self, edge: usize) -> Vec2 {
        self.position(self.vertex(edge))
    }

    #[inline]
    fn end(&self, edge: usize) -> Vec2 {
        self.position(self.vertex(edge_end(edge)))
    }
}

/// What the set's edges are tested against: the set itself, each pair once, or a list of edges.
#[derive(Clone, Copy)]
pub(super) enum Against<'a> {
    Itself,
    Edges(&'a [usize]),
}

/// Whether the boxes of two segments touch.
fn boxes_touch(a: (Vec2, Vec2), b: (Vec2, Vec2)) -> bool {
    let (a_low, a_high) = (least2(a.0, a.1), most2(a.0, a.1));
    let (b_low, b_high) = (least2(b.0, b.1), most2(b.0, b.1));
    a_low[0] <= b_high[0] && a_high[0] >= b_low[0] && a_low[1] <= b_high[1] && a_high[1] >= b_low[1]
}

#[derive(Default)]
pub(super) struct EdgeGrid {
    edges: Vec<usize>,
    cell_size: f32,
    origin: Vec2,
    width: u32,
    height: u32,
    /// Per cell its first entry, `NONE` when empty; empty while no grid is built.
    heads: Vec<usize>,
    /// Per cell its last entry, to append in order.
    tails: Vec<usize>,
    /// Entries: an edge and the cell's next entry.
    entries: Vec<(usize, usize)>,
    potential: Vec<usize>,
    walked: Vec<u32>,
}

impl EdgeGrid {
    /// The set made `edges`, in order, with no grid.
    pub(super) fn reset_to(&mut self, edges: impl IntoIterator<Item = usize>) {
        self.edges.clear();
        self.edges.extend(edges);
        self.heads.clear();
    }

    /// Whether the segment `v1 v2` crosses an edge of the set.
    pub(super) fn crosses_segment(
        &mut self,
        corners: Corners,
        v1: Vec2,
        v2: Vec2,
        epsilon: f32,
    ) -> bool {
        if !self.use_grid(corners) {
            return (self.edges.iter()).any(|&edge| {
                segments_cross(v1, v2, corners.start(edge), corners.end(edge), epsilon)
            });
        }
        self.potential_edges(v1, v2);
        let mut previous = NONE;
        for &edge in &self.potential {
            if edge == previous {
                continue;
            }
            if segments_cross(v1, v2, corners.start(edge), corners.end(edge), epsilon) {
                return true;
            }
            previous = edge;
        }
        false
    }

    /// Whether an edge `against` names crosses an edge of the set that is not in `ignore` and
    /// shares no vertex with it.
    pub(super) fn crosses_edges(
        &mut self,
        corners: Corners,
        epsilon: f32,
        against: Against,
        ignore: &[usize],
    ) -> bool {
        let grid = self.use_grid(corners);
        let own = std::mem::take(&mut self.edges);
        let (tested, against_itself) = match against {
            Against::Itself => (&own[..], true),
            Against::Edges(edges) => (edges, false),
        };
        let mut crossed = false;
        'tested: for (i, &edge1) in tested.iter().enumerate() {
            let ends1 = [corners.vertex(edge1), corners.vertex(edge_end(edge1))];
            let segment1 = (corners.position(ends1[0]), corners.position(ends1[1]));
            let mut first = 0;
            if !grid {
                if against_itself {
                    first = i + 1;
                    if first == tested.len() {
                        break;
                    }
                }
            } else {
                self.potential_edges(segment1.0, segment1.1);
            }
            let others: &[usize] = if grid { &self.potential } else { &own };
            let mut previous = NONE;
            for &edge2 in &others[first..] {
                if edge1 == edge2 || edge2 == previous {
                    continue;
                }
                previous = edge2;
                if ignore.contains(&edge2) {
                    continue;
                }
                let ends2 = [corners.vertex(edge2), corners.vertex(edge_end(edge2))];
                if ends1[0] == ends2[0]
                    || ends1[0] == ends2[1]
                    || ends1[1] == ends2[0]
                    || ends1[1] == ends2[1]
                {
                    continue;
                }
                let segment2 = (corners.position(ends2[0]), corners.position(ends2[1]));
                if boxes_touch(segment1, segment2)
                    && segments_cross(segment1.0, segment1.1, segment2.0, segment2.1, epsilon)
                {
                    crossed = true;
                    break 'tested;
                }
            }
        }
        self.edges = own;
        crossed
    }

    /// Whether the test walks the grid: past twenty edges, once it is built.
    fn use_grid(&mut self, corners: Corners) -> bool {
        if self.edges.len() <= 20 {
            return false;
        }
        !self.heads.is_empty() || self.build(corners)
    }
}
