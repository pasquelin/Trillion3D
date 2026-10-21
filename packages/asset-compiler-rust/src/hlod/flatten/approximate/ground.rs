//! The approximated shell cut at a horizontal ground plane, what lies below it taken away and, when
//! asked, the cut filled flat (`cut_below`), in the frame and units its steps are measured in:
//! centimetres, `z` up — our point `(x, y, z)` in metres read as `100 · (x, z, y)`, each
//! triangle's corners in their order, so every tolerance, side test and cross product reads as it
//! does there:
//!
//! 1. the mesh (`Mesh`) built from the shell: every vertex appended, then every triangle in order,
//!    a triangle the mesh refuses (`Refusal`) left out;
//! 2. the cut (`cut.rs`): the edges crossing the plane split where they cross it, the triangles on
//!    it and every vertex above it taken away, the new edges of no length collapsed, the boundary
//!    the cut left walked into loops and spans;
//! 3. the fill (`fill.rs`), when asked: those loops and spans laid on the plane, nested into solid
//!    regions (`complex.rs`, the polygon tests in `polygon.rs`), each region triangulated and its
//!    triangles appended;
//! 4. the mesh read back as its ids enumerate it: its standing vertices by ascending id, numbered
//!    from zero — those the cut left with no triangle among them —, its standing triangles by
//!    ascending id, back in metres with `y` up.
mod complex;
mod cut;
mod fill;
mod polygon;
use crate::hlod::flatten::mesh::Mesh;
use crate::hlod::flatten::units::{from_reference, to_reference};

/// The mesh the cut edits and each vertex's point by id — a freed vertex's slot keeping its last
/// point —, in centimetres, `z` up.
struct Shape {
    mesh: Mesh,
    points: Vec<[f64; 3]>,
}

/// The shell of `positions` and `indices` — in metres, `y` up — cut at the horizontal plane
/// through `origin` — the scene bounds' centre at the ground's height —, what lies below it taken
/// away and the cut filled when `fill` says so (module doc): the positions and triangles left.
pub(super) fn cut_below(
    positions: &[f32],
    indices: &[u32],
    origin: [f64; 3],
    fill: bool,
) -> (Vec<f32>, Vec<u32>) {
    let points: Vec<[f64; 3]> = (positions.chunks_exact(3))
        .map(|p| to_reference([p[0], p[1], p[2]].map(f64::from)))
        .collect();
    let mut mesh = Mesh::with_vertices(points.len());
    for tri in indices.chunks_exact(3) {
        // A triangle the mesh refuses is left out.
        let _ = mesh.append([tri[0], tri[1], tri[2]].map(|v| v as usize));
    }
    let mut shape = Shape { mesh, points };
    let origin = to_reference(origin);
    let boundary = shape.cut(origin);
    if fill {
        shape.fill(&boundary, origin);
    }
    shape.read_back()
}

impl Shape {
    /// The mesh as its ids enumerate it (module doc, step 4): flat positions in metres, `y` up,
    /// and the triangles' corners.
    fn read_back(&self) -> (Vec<f32>, Vec<u32>) {
        let mesh = &self.mesh;
        let mut rank = vec![0u32; mesh.vertex_count()];
        let mut positions = Vec::new();
        for v in (0..mesh.vertex_count()).filter(|&v| mesh.is_vertex(v)) {
            rank[v] = (positions.len() / 3) as u32;
            positions.extend(from_reference(self.points[v]).map(|c| c as f32));
        }
        let indices = (0..mesh.triangles.len())
            .filter(|&t| mesh.is_triangle(t))
            .flat_map(|t| mesh.triangles[t].map(|v| rank[v]))
            .collect();
        (positions, indices)
    }
}
