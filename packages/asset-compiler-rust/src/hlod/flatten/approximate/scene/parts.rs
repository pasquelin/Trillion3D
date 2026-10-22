//! One source mesh sorted into the meshes the field wraps (`Wrap`), as the objects placing it read
//! it. Its vertices welded, once, in its own space — or read as its vertex buffers hold them, where
//! the layer reads its sources' render meshes (`useRenderLODMeshes`). Without thickening, the
//! whole mesh one wrapped mesh at every placement. With it:
//! 1. the placements grouped by scale (`scale_classes`): a placement joins the first group whose
//!    first scale lies within `SCALE_TOLERANCE` of its own on every axis;
//! 2. each connected component (`topology::components`) measured under each group's scale — thin
//!    when planar within the desired thickness under any of them (`topology::thickness`);
//! 3. a component not thin, or thin but holding more than `MOST_COPIED_TRIANGLES` once copied for
//!    every group, kept in the mesh's own space, all of them one wrapped mesh at every placement —
//!    the whole mesh as it is when every component is closed and none is thin;
//! 4. a thin component copied for each group, scaled by that group's first scale, dropped when
//!    its scaled box's longest side is under the tiny size, its thickness its own when closed —
//!    measured across the plane the test read, at most the desired one — and none when open; short
//!    of the desired thickness, thickened by a shell of half the thickness it lacks. Each copy is
//!    placed by its group's placements with their scale taken out.
use super::topology::{components, copied, seed_points, thickness};
use super::Thinning;
use crate::compiler::source::node_transform::Mat4;
use crate::hlod::flatten::approximate::winding::Affine;
use crate::hlod::flatten::approximate::SourceMesh;
use crate::hlod::flatten::bake::tree::{points_of, triangles_of};
use trillion3d_math::geometry::aabb::{aabb_of, longest_side};

/// How far apart two placements' scales may lie on every axis and still share their copies.
const SCALE_TOLERANCE: f64 = 0.01;
/// The most triangles a thin component may hold once copied for every scale group: past it, the
/// component stays in the mesh's own space.
const MOST_COPIED_TRIANGLES: usize = 1_000_000;

/// A mesh the field wraps, in its own space: its vertices and triangles, the radius of the shell
/// thickening it — none for a mesh read by its winding number —, its seed points — some of its
/// vertices (`topology::seed_points`) —, and the transforms placing it in the scene.
pub(in crate::hlod::flatten::approximate) struct Wrap {
    pub points: Vec<[f64; 3]>,
    pub triangles: Vec<[usize; 3]>,
    pub shell: Option<f64>,
    pub seeds: Vec<[f64; 3]>,
    pub placements: Vec<Affine>,
}

impl Wrap {
    /// The wrapped mesh of `points` and `triangles` thickened by `shell`, placed by `placements`.
    fn new(
        (points, triangles): (Vec<[f64; 3]>, Vec<[usize; 3]>),
        shell: Option<f64>,
        placements: Vec<Affine>,
    ) -> Self {
        let seeds = seed_points(&points);
        Self {
            points,
            triangles,
            shell,
            seeds,
            placements,
        }
    }
}

/// The scale groups of `scales`: each its first scale and its placements' ranks, a placement
/// joining the first group whose first scale lies within `SCALE_TOLERANCE` of its own on every
/// axis, a new group otherwise.
fn scale_classes(scales: &[[f64; 3]]) -> Vec<([f64; 3], Vec<usize>)> {
    let mut classes: Vec<([f64; 3], Vec<usize>)> = Vec::new();
    for (rank, scale) in scales.iter().enumerate() {
        let near = |first: &[f64; 3]| (0..3).all(|k| (scale[k] - first[k]).abs() < SCALE_TOLERANCE);
        match classes.iter_mut().find(|(first, _)| near(first)) {
            Some((_, members)) => members.push(rank),
            None => classes.push((*scale, vec![rank])),
        }
    }
    classes
}

/// The meshes `mesh` is wrapped in as the objects placing it by `placed` read it, thickened by
/// `thinning` (the module's steps); its vertices welded by position, or, `as_stored`, read as its
/// vertex buffers hold them, split wherever its attributes are (`useRenderLODMeshes`).
pub(super) fn mesh_parts(
    mesh: &SourceMesh,
    placed: &[&Mat4],
    (thinning, as_stored): (Option<Thinning>, bool),
) -> Vec<Wrap> {
    let welded;
    let (positions, indices) = if as_stored {
        (&mesh.positions[..], &mesh.indices[..])
    } else {
        welded = crate::simplify::welded_region(&mesh.positions, &mesh.indices);
        (&welded.0[..], &welded.1[..])
    };
    let (points, triangles) = (points_of(positions), triangles_of(indices));
    let placing = || -> Vec<Affine> { placed.iter().map(|m| Affine::placing(m)).collect() };
    let Some(Thinning {
        thickness: desired,
        tiny,
    }) = thinning
    else {
        return vec![Wrap::new((points, triangles), None, placing())];
    };
    let unscaled: Vec<([f64; 3], Affine)> = placed.iter().map(|m| Affine::unscaled(m)).collect();
    let scales: Vec<[f64; 3]> = unscaled.iter().map(|(scale, _)| *scale).collect();
    let classes = scale_classes(&scales);
    let parts = components(&triangles);
    let (mut kept, mut wraps) = (Vec::new(), Vec::new());
    let (mut open, mut thin) = (0, 0);
    for (own, closed) in &parts {
        open += usize::from(!closed);
        let measured: Vec<(f64, bool)> = (classes.iter())
            .map(|(scale, _)| thickness(&points, own, &triangles, (*scale, desired)))
            .collect();
        let is_thin = measured.iter().any(|&(_, t)| t);
        thin += usize::from(is_thin);
        if !is_thin || own.len() * classes.len() > MOST_COPIED_TRIANGLES {
            kept.push(own);
            continue;
        }
        for ((scale, members), &(depth, _)) in classes.iter().zip(&measured) {
            let scaled = |p: [f64; 3]| -> [f64; 3] { std::array::from_fn(|k| p[k] * scale[k]) };
            let copy = copied(&points, (own, &triangles), scaled);
            let (low, high) = aabb_of(copy.0.iter().copied());
            if tiny.is_some_and(|tiny| longest_side(low, high) < tiny) {
                continue;
            }
            let own_thickness = if *closed { depth.min(desired) } else { 0.0 };
            let shell = (own_thickness < desired).then_some(0.5 * (desired - own_thickness));
            let placements = members.iter().map(|&j| unscaled[j].1).collect();
            wraps.push(Wrap::new(copy, shell, placements));
        }
    }
    if open == 0 && thin == 0 {
        wraps.push(Wrap::new((points, triangles), None, placing()));
    } else if !kept.is_empty() {
        // Each kept component copied on its own, one after the other.
        let (mut at, mut over) = (Vec::new(), Vec::new());
        for own in kept {
            let (copy, copied_triangles) = copied(&points, (own, &triangles), |p| p);
            let base = at.len();
            over.extend(copied_triangles.into_iter().map(|t| t.map(|v| v + base)));
            at.extend(copy);
        }
        wraps.push(Wrap::new((at, over), None, placing()));
    }
    wraps
}
