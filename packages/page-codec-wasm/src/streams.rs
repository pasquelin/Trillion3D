//! The values a page carries, stream by stream, whichever form holds them: what the encoder
//! gathers from a primitive (`encode.rs`), the disk page writes as deltas (`disk.rs`) and the
//! resident page packs as fields (`resident.rs`). Each component of each stream is a vector of the
//! values of its fields, the corner stream's the laid indices of the vertices (`clusters::strip`).

use crate::clusters::strip::Strip;
use crate::encode::cells::Cell;
use crate::{Header, FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT, MAX_UV_SETS, UV_FLAGS};

/// A stream of a page on disk, which holds one value a component per field it stores.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Part {
    /// The stored position each vertex takes, when positions are stored once: one component, a
    /// field for every vertex.
    Links,
    /// The cells of the positions above the page's least, `x`, `y`, `z`: the table of a page that
    /// stores each once, else those of the vertices the page stores.
    Position,
    /// The octahedral cells of the normals, `x` then `y`.
    Normal,
    /// The stored tangents' codes: one component.
    Tangent,
    /// The colour bytes above the page's least, red to alpha.
    Color,
    /// The float codes of a texture set above its least, `u` then `v`.
    Uv(usize),
}

/// The values of a page's fields, the resident page's: empty for a stream the page does not
/// carry. A vertex is a field of each stream (`position` and `links` apart: its position is a
/// field of `position`, or of the field its link names).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Streams {
    /// The laid index of the vertex of every corner, triangle after triangle.
    pub corners: Vec<u32>,
    pub position: [Vec<u32>; 3],
    pub links: Vec<u32>,
    pub normal: [Vec<u32>; 2],
    pub uv: [[Vec<u32>; 2]; MAX_UV_SETS],
    pub color: [Vec<u32>; 4],
    pub tangent: Vec<u32>,
    /// The words of the skin's and the morph targets' streams as the resident page holds them
    /// (`deform.rs`): copied from the disk page to the resident one as they are.
    pub deform: Vec<u32>,
}

impl Streams {
    /// Vertex `v` on the grids of its page: its cells.
    pub fn cell(&self, h: &Header, v: usize) -> Cell {
        let slot = if h.links_positions() {
            self.links[v] as usize
        } else {
            v
        };
        let at = |stream: &Vec<u32>, index: usize| stream.get(index).copied().unwrap_or(0);
        Cell {
            position: [0, 1, 2].map(|c| at(&self.position[c], slot)),
            normal: [0, 1].map(|c| at(&self.normal[c], v)),
            uv: core::array::from_fn(|set| [0, 1].map(|c| at(&self.uv[set][c], v))),
            color: [0, 1, 2, 3].map(|c| at(&self.color[c], v)),
            tangent: at(&self.tangent, v),
            extra: 0,
        }
    }

    /// The streams of a page whose vertices lie at `cells`: its positions the `table` given when it
    /// stores each once — whoever names a vertex —, else a field a vertex; every other stream a
    /// field a vertex.
    pub fn of_cells(
        h: &Header,
        cells: &[Cell],
        table: Option<[Vec<u32>; 3]>,
        (links, corners, deform): (Vec<u32>, Vec<u32>, Vec<u32>),
    ) -> Self {
        let each = |present: bool, value: &dyn Fn(&Cell) -> u32| -> Vec<u32> {
            if present {
                cells.iter().map(value).collect()
            } else {
                Vec::new()
            }
        };
        let has = |flag: u32| h.flags & flag != 0;
        Self {
            corners,
            position: table.unwrap_or_else(|| {
                [0, 1, 2].map(|c| cells.iter().map(|cell| cell.position[c]).collect())
            }),
            links,
            normal: [0, 1].map(|c| each(has(FLAG_NORMAL), &|cell| cell.normal[c])),
            uv: core::array::from_fn(|set| {
                [0, 1].map(|c| each(has(UV_FLAGS[set]), &|cell| cell.uv[set][c]))
            }),
            color: [0, 1, 2, 3].map(|c| each(has(FLAG_COLOR), &|cell| cell.color[c])),
            tangent: each(has(FLAG_TANGENT), &|cell| cell.tangent),
            deform,
        }
    }
}

/// A page whole, ready to be written on disk or laid out resident: its header, the values of its
/// fields and the strips its triangles are laid in.
#[derive(Clone, Debug, PartialEq)]
pub struct Page {
    pub header: Header,
    pub streams: Streams,
    pub strip: Strip,
}
