//! A chart's connectivity, built from its faces alone, and the root chart built from the input.
//!
//! The root chart (`layout`, `split`, `walk`): the input corners renumbered by walking each
//! corner's fan of faces through the given adjacency, so that corners which meet only at a point
//! become separate vertices; then the faces on both sides of an edge more than two faces claim,
//! or of an edge whose faces the adjacency does not join, given fresh vertices and cut from their
//! neighbours (with every face a false edge ties to them); repeated until no edge is split.
//!
//! The connectivity (`connect`, `edges`, `rings`, `clean`):
//!
//! 1. every vertex's rings cleared;
//! 2. every edge found, in face order, its first face the first to name it; an edge a third face
//!    names makes the chart a non-manifold;
//! 3. when the chart may hold bowties, each vertex whose fans of faces do not close into one is
//!    split, one new vertex per fan after the first, and the edges found again;
//! 4. the two faces of every inner edge checked to wind the same way;
//! 5. every vertex's neighbours sorted around it in the faces' winding, from its boundary edge for
//!    a boundary vertex, and its edges sorted to match;
//! 6. the false edges made unsplittable.
use super::fail::invalid_data;
use super::mesh::{Chart, Face, Vert};
use super::source::Source;

mod clean;
mod connect;
mod edges;
mod layout;
mod rings;
mod split;
mod walk;

pub(crate) use layout::{root_layout, RootLayout};

impl<'a> Chart<'a> {
    /// The root chart of `source`, from its renumbered corners.
    pub(crate) fn root(source: &'a Source, layout: RootLayout) -> crate::Result<Chart<'a>> {
        let mut chart = Chart::new(source);
        chart.verts = (layout.roots.iter().enumerate())
            .map(|(i, &root)| Vert {
                id: i as u32,
                root,
                ..Vert::default()
            })
            .collect();
        chart.faces = (layout.corners.iter().enumerate())
            .map(|(i, &verts)| Face {
                id: i as u32,
                root: i as u32,
                verts,
                ..Face::default()
            })
            .collect();
        if !chart.connect()? {
            return Err(invalid_data("the mesh is not a manifold"));
        }
        chart.diagonal = source.diagonal;
        chart.area_3d = source.area;
        chart.base_l2 = chart.base_l2_stretch();
        Ok(chart)
    }
}
