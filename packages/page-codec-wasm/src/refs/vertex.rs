//! The vertices a page names or stores: its references (`Refs`) and the whole vertex they are compared by.

use super::*;

/// The vertices a page names, and the pairs of clusters it names them in.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Refs {
    /// Whether each vertex of the page is named (true) or stored.
    pub named: Vec<bool>,
    /// The pair of each cluster named (rank of its streaming page, then its place there), each
    /// once, ascending.
    pub pairs: Vec<u32>,
    /// For each vertex named, in vertex order: the rank of its cluster's pair among `pairs`, and
    /// its index in that cluster.
    pub entries: Vec<(u8, u8)>,
}

impl Refs {
    /// A page of `vertices` vertices that stores them all.
    pub fn none(vertices: usize) -> Self {
        Self {
            named: vec![false; vertices],
            ..Self::default()
        }
    }

    /// The resident page of each cluster the pairs name, in the order of the pairs, as they lie in
    /// `pool`: the page's own streaming page starts at word `units[0]` of it, the one of rank `r`
    /// of its dependencies at `units[r]` (`NO_UNIT` for one not resident), a cluster `place` words
    /// from there. The page itself, which no pool holds, is the empty slice. A pair that names
    /// nothing the pool holds refuses the page (`PageError::Refs`).
    pub fn pages_in<'a>(&self, pool: &'a [u8], units: &[u32]) -> Result<Vec<&'a [u8]>, PageError> {
        self.pairs
            .iter()
            .map(|&pair| {
                if pair == SELF_PLACE {
                    return Ok(&pool[..0]);
                }
                let unit = units.get((pair >> REF_PLACE_BITS) as usize).copied();
                let word = unit
                    .filter(|&unit| unit != NO_UNIT)
                    .ok_or(PageError::Refs)?;
                let at = (u64::from(word) + u64::from(pair & SELF_PLACE)) * 4;
                pool.get(usize::try_from(at).map_err(|_| PageError::Refs)?..)
                    .ok_or(PageError::Refs)
            })
            .collect()
    }
}

/// The attribute bits and the precisions that decide whether two vertices of two pages can be one
/// vertex: the same attributes on the same grids.
pub(super) fn signature(h: &Header) -> u64 {
    let attributes = FLAG_NORMAL | UV_MASK | FLAG_COLOR | FLAG_TANGENT;
    u64::from(h.flags & attributes)
        | u64::from(h.position.precision as i8 as u8) << 16
        | u64::from(h.normal_precision) << 24
        | u64::from(h.tangent_precision) << 32
}

/// A vertex as every page on one set of grids reads it, whichever page holds it: its cells with
/// the page's ranges added back. Two vertices of two pages that are equal here decode alike.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Vertex {
    format: u64,
    position: [i32; 3],
    normal: [u32; 2],
    tangent: u32,
    color: [u32; 4],
    uv: [[u32; 2]; crate::MAX_UV_SETS],
}

impl Vertex {
    /// The vertex of cells `cell` on the grids of the page of header `h`.
    pub fn of(h: &Header, cell: &Cell) -> Self {
        let has = |flag: u32| h.flags & flag != 0;
        Self {
            format: signature(h),
            position: [0, 1, 2].map(|c| h.position.start[c].wrapping_add(cell.position[c] as i32)),
            normal: if has(FLAG_NORMAL) {
                cell.normal
            } else {
                [0; 2]
            },
            tangent: if has(FLAG_TANGENT) { cell.tangent } else { 0 },
            color: if has(FLAG_COLOR) {
                [0, 1, 2, 3].map(|c| h.color.min[c] + cell.color[c])
            } else {
                [0; 4]
            },
            uv: core::array::from_fn(|set| {
                if has(UV_FLAGS[set]) {
                    [0, 1].map(|c| h.uv[set].min[c] + cell.uv[set][c])
                } else {
                    [0; 2]
                }
            }),
        }
    }

    /// The cells this vertex takes on the grids of the page of header `h`: none when the page
    /// carries other attributes or other precisions, or a range of its holds not the vertex.
    pub fn cell(&self, h: &Header) -> Option<Cell> {
        if self.format != signature(h) {
            return None;
        }
        let within =
            |value: i64, bits: u32| (0..1i64 << bits).contains(&value).then_some(value as u32);
        let mut cell = Cell {
            normal: self.normal,
            tangent: self.tangent,
            ..Cell::default()
        };
        for c in 0..3 {
            let offset = i64::from(self.position[c]) - i64::from(h.position.start[c]);
            cell.position[c] = within(offset, h.position.bits[c])?;
        }
        if h.flags & FLAG_COLOR != 0 {
            for c in 0..4 {
                let offset = i64::from(self.color[c]) - i64::from(h.color.min[c]);
                cell.color[c] = within(offset, h.color.bits[c])?;
            }
        }
        for (set, flag) in UV_FLAGS.into_iter().enumerate() {
            if h.flags & flag != 0 {
                for c in 0..2 {
                    let offset = i64::from(self.uv[set][c]) - i64::from(h.uv[set].min[c]);
                    cell.uv[set][c] = within(offset, h.uv[set].bits[c])?;
                }
            }
        }
        Some(cell)
    }

    /// The vertex's hash: the key of the maps that find the vertices a cluster holds.
    pub fn hash(&self) -> u64 {
        let mut hasher = WordHasher::default();
        let [low, high] = [self.format as u32, (self.format >> 32) as u32];
        // Only the sets the page holds (`format` names them): an absent one is zero in every vertex
        // of the format, and adds nothing to tell two vertices apart.
        let sets = UV_FLAGS
            .into_iter()
            .enumerate()
            .filter(|&(_, flag)| low & flag != 0)
            .flat_map(|(set, _)| self.uv[set]);
        let words = [low, high]
            .into_iter()
            .chain(self.position.map(|p| p as u32))
            .chain(self.normal)
            .chain([self.tangent])
            .chain(self.color)
            .chain(sets);
        words.for_each(|word| hasher.write_u32(word));
        hasher.finish()
    }
}

/// The vertices of a page, one each: its cells with its ranges added back.
pub fn vertices_of(p: &Page) -> Vec<Vertex> {
    (0..p.header.vertex_count)
        .map(|v| Vertex::of(&p.header, &p.streams.cell(&p.header, v)))
        .collect()
}
