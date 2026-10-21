//! The cut filled flat (`Shape::fill`):
//!
//! 1. the boundary's loops, then its spans, each laid on the plane: a vertex's offset from the
//!    plane's origin read along the plane's two axes (`plane_axes`) — the cut's one boundary keeps
//!    the sign of one, so the plane's normal is the cut's, `DOWN`;
//! 2. the polygons nested into solid regions, outer loops with their holes (`solid_regions`);
//! 3. each region, in turn, triangulated as a polygon with holes (`fill_polygon`), each corner of
//!    a triangle the vertex it indexes among the outer loop's vertices then each hole's in order,
//!    and the triangle appended, one the mesh refuses (`Refusal`) skipped.
use super::complex::solid_regions;
use super::cut::DOWN;
use super::Shape;
use crate::hlod::flatten::mesh::Boundaries;
use crate::hlod::flatten::planar::delaunay::fill_polygon;
use trillion3d_math::vector::vecn::{dot, sub};

impl Shape {
    /// The shape's cut, of boundary `boundary` on the plane through `origin`, filled (module doc).
    pub(super) fn fill(&mut self, boundary: &Boundaries, origin: [f64; 3]) {
        let rings: Vec<&[usize]> = (boundary.loops.iter())
            .chain(&boundary.spans)
            .map(Vec::as_slice)
            .collect();
        let [across, along] = plane_axes(DOWN);
        let polygons: Vec<Vec<[f64; 2]>> = (rings.iter())
            .map(|ring| {
                (ring.iter())
                    .map(|&v| {
                        let offset = sub(self.points[v], origin);
                        [dot(across, offset), dot(along, offset)]
                    })
                    .collect()
            })
            .collect();
        for region in solid_regions(&polygons) {
            let holes: Vec<Vec<[f64; 2]>> = (region.holes.iter())
                .map(|&h| polygons[h].clone())
                .collect();
            let corners: Vec<usize> = std::iter::once(region.outer)
                .chain(region.holes.iter().copied())
                .flat_map(|k| rings[k].iter().copied())
                .collect();
            for [a, b, c] in fill_polygon(&polygons[region.outer], &holes) {
                // A triangle the mesh refuses is skipped.
                let _ = self.mesh.append([corners[a], corners[b], corners[c]]);
            }
        }
    }
}

/// The plane's two axes across unit normal `[x, y, z]` pointing down (`z < 0`), made without
/// a root (Duff et al. 2017, "Building an Orthonormal Basis, Revisited"), the downward hemisphere's
/// formula: with `a = 1 / (1 − z)` and `b = x·y·a`, the axes `(1 − x²·a, −b, x)` and
/// `(b, y²·a − 1, −y)`.
fn plane_axes([x, y, z]: [f64; 3]) -> [[f64; 3]; 2] {
    let a = 1.0 / (1.0 - z);
    let b = x * y * a;
    [[1.0 - x * x * a, -b, x], [b, y * y * a - 1.0, -y]]
}
