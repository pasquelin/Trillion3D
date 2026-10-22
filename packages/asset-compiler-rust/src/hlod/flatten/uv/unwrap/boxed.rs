//! A topology's texture coordinates projected from the faces of its bounding box — what an
//! approximated shell takes where the spectral charts fail:
//!
//! 1. the mesh made of the topology as a mesh holds one (`Base`), its points in centimetres, each
//!    triangle given the plane it faces: the box face its normal is nearest, the axis of its
//!    largest component and whether that component is positive (`plane`);
//! 2. the triangles joined across their sides into regions of one plane, a region of one triangle
//!    merged into the neighbour that holds more, the triangles then moved into the region that
//!    borders all their other sides (`Regions`), each triangle then facing the box face of its
//!    region's axis on the side its normal turns to;
//! 3. each corner given the coordinates its vertex has under its triangle's plane: the vertex's
//!    offset from the bounds' centre along the two axes the plane's axis leaves (`PROJECTION`),
//!    each times its factor, the first's also times the sign of the normal's component along the
//!    plane's axis; a vertex has one set of coordinates for each plane that names it.
//!
//! The islands are the triangles joined across the sides whose two texture vertices they share.
//!
//! A vertex that two fans of triangles of one plane meet at, and no side joins, is a bowtie of the
//! coordinates: the projection splits those into vertices of their own, which this does not. It
//! renames a vertex and moves no coordinate; an island is joined across sides, and a bowtie's fans
//! share none; and the repack that follows splits every bowtie itself. So no coordinate and no
//! island changes.
use super::base::Base;
use super::patches::{components_where, Faces, BORDER_ROUNDS};
use super::regions::Regions;
use super::{Topology, Unwrapped};
use crate::hlod::flatten::uv::charts::islands;
use trillion3d_math::geometry::aabb::{aabb_of, centre};
use trillion3d_math::vector::vec3::dominant_axis;

/// Per major axis, the two axes projected on and the factor each is multiplied by — the first's
/// also by the sign of the normal's major component.
const PROJECTION: [([usize; 2], [f32; 2]); 3] = [
    ([1, 2], [-1.0, -1.0]),
    ([0, 2], [1.0, -1.0]),
    ([0, 1], [1.0, 1.0]),
];

/// The plane a triangle of normal `normal` faces when its major axis is `axis`: that axis, and
/// that axis again, or three above it where the normal's component is positive.
fn plane_of(normal: [f64; 3], axis: usize) -> (usize, usize) {
    (axis, if normal[axis] > 0.0 { axis + 3 } else { axis })
}

/// The plane a triangle of normal `normal` faces: the axis of its largest component, the last of
/// equals (`plane_of`).
fn plane(normal: [f64; 3]) -> (usize, usize) {
    plane_of(normal, dominant_axis(normal))
}

/// The sign of `x`: 1, -1, or 0 for zero.
fn sign(x: f64) -> f32 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        0.0
    }
}

/// The planes the triangles face (module doc, 1 and 2): each triangle's own, then those of the
/// regions the triangles of one plane form changed where small regions were merged or borders
/// moved.
fn box_planes(normals: &[[f64; 3]], across: &[[usize; 3]]) -> Vec<(usize, usize)> {
    let mut planes: Vec<(usize, usize)> = normals.iter().map(|&n| plane(n)).collect();
    let sets = components_where(across, |a, b| planes[a] == planes[b]);
    let axes: Vec<usize> = sets.iter().map(|set| planes[set[0]].0).collect();
    let mut regions = Regions::of(across, sets);
    // A region of one triangle merged into a neighbour; a triangle moved into the region that
    // borders all its other sides.
    let merged = regions.merge_small(1);
    let moved = regions.optimize_borders(BORDER_ROUNDS);
    if merged || moved {
        for k in (0..regions.count()).filter(|&k| regions.is_region(k)) {
            for &t in regions.triangles(k) {
                planes[t] = plane_of(normals[t], axes[k]);
            }
        }
    }
    planes
}

/// `topology` projected from its bounding box (module doc), every triangle the mesh holds given
/// coordinates, none of its corners the others'.
pub(crate) fn boxed(topology: &Topology) -> Unwrapped {
    let base = Base::in_centimetres(topology);
    let faces = Faces::of(&base);
    let planes = box_planes(&faces.normals, &faces.across);
    let (low, high) = aabb_of(base.points.iter().copied());
    let middle = centre(low, high);
    // Per vertex and plane bucket, the texture vertex numbered when a corner first names it.
    let mut named = vec![[u32::MAX; 6]; base.points.len()];
    let mut coordinates: Vec<[f32; 2]> = Vec::new();
    let mut vertex_of = vec![0usize; 3 * base.triangle_count()];
    for (t, tri) in base.mesh.triangles.iter().enumerate() {
        let (axis, bucket) = planes[t];
        let ([first, second], [flip_first, flip_second]) = PROJECTION[axis];
        let toward = sign(faces.normals[t][axis]) * flip_first;
        for (k, &v) in tri.iter().enumerate() {
            if named[v][bucket] == u32::MAX {
                named[v][bucket] = coordinates.len() as u32;
                let p = [0, 1, 2].map(|i| base.points[v][i] - middle[i]);
                coordinates.push([p[first] as f32 * toward, p[second] as f32 * flip_second]);
            }
            vertex_of[3 * t + k] = named[v][bucket] as usize;
        }
    }
    let groups = islands(base.triangle_count(), &vertex_of, |_| false);
    let uv = |b: usize, k: usize| coordinates[vertex_of[3 * b + k]].map(f64::from);
    base.unwrapped(topology.triangles.len(), uv, groups)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_triangle_faces_the_box_face_of_its_largest_component() {
        assert_eq!(plane([0.0, 0.0, 1.0]), (2, 5));
        assert_eq!(plane([0.0, 0.0, -1.0]), (2, 2));
        assert_eq!(plane([-1.0, 0.5, 0.2]), (0, 0));
        // The last of equals: x and y tie, so y; none at all, so z.
        assert_eq!(plane([1.0, 1.0, 0.0]), (1, 4));
        assert_eq!(plane([0.0, 0.0, 0.0]), (2, 2));
    }

    #[test]
    fn a_floor_is_projected_flat_from_its_box_centre() {
        // A floor a metre square, up the second axis, as two triangles.
        let points = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
        ];
        let triangles = [[0, 1, 2], [0, 2, 3]];
        let topology = Topology {
            points: &points,
            triangles: &triangles,
        };
        let unwrapped = boxed(&topology);
        assert_eq!(unwrapped.held, [true, true]);
        // One island: the triangles share an edge and the plane.
        assert_eq!(unwrapped.islands.len(), 1);
        // In centimetres about the centre: the third axis is up, the first triangle faces down, so
        // the first coordinate is turned.
        assert_eq!(
            unwrapped.corners[..3],
            [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0]]
        );
    }
}
