//! The iso-surface of a field, extracted as a mesh of quads and triangles over shared points by
//! the dual method of OpenVDB's volume-to-mesh conversion on a level set, step for step:
//!
//! 1. the cells the surface may cross (`crossing`) — a cell being the cube from a voxel to its
//!    neighbours towards `+x`, `+y`, `+z` (`cell`) —: the four cells around each edge between two
//!    voxels on opposite sides of the iso value;
//! 2. each crossed cell's flags (`flags`): its corners' signs, settled across an ambiguous face
//!    with the neighbour sharing it, whether its voxel lies inside, and which of its three edges
//!    from the voxel the surface crosses; beside them, each cell's point slot;
//! 3. when the adaptivity passes `10⁻⁷`, each leaf's cells merged into regions of one point
//!    (`merge`): blocks of 2³, 4³ and 8³ cells free of ambiguity (`manifold`) whose field
//!    directions agree within the adaptivity;
//! 4. the points (`points`): each lone cell's sheet points, each region's mean, leaf by leaf;
//! 5. the polygons (`polygons`): per crossed edge, the quad over the points of its four cells,
//!    a triangle or nothing where merged cells share points;
//! 6. under the same adaptivity, the points of the triangles that face against the field moved to
//!    the mean of their polygons (`relax`).
//!
//! The signs compare the field with the iso value rounded to single precision; the points
//! interpolate in double precision from the iso value as given, and are kept in single precision.
//! The leaves are visited in the tree's order, and each leaf's work reads only what the steps
//! before it made, so the leaves of a step run in parallel and the mesh comes out the same. The
//! tables the steps read are the method's own (`cases`, `sheets`).
//!
//! The steps are those the method runs in the configuration the simplify builder uses — a level
//! set, no second field to stitch seams against, no surface mask, no adaptivity field or mask, the
//! relaxation on — and no other. Every tile of the field is inactive, so the method's pass over
//! the borders of active tiles never runs either.
use super::tree::Tree;

mod cases;
mod cell;
mod crossing;
mod flags;
mod manifold;
mod merge;
mod points;
mod polygons;
mod relax;
mod sheets;

/// A mesh of quads and triangles over shared points, as the extraction makes it.
pub(crate) struct Polygonal {
    /// World-space points (index-space points times the voxel), single precision.
    pub points: Vec<[f32; 3]>,
    /// The quads, the leaves' in the tree's order, each four points in turn around it.
    pub quads: Vec<[u32; 4]>,
    /// The triangles merged cells leave, the leaves' in the tree's order, facing as the quads do.
    pub triangles: Vec<[u32; 3]>,
}

/// The `iso` surface of `field` (world-unit distances on a grid of `voxel` world units), merged
/// under `adaptivity`.
///
/// The merge and the relaxation run only when the adaptivity passes `10⁻⁷`. Without them no two
/// cells share a point and every quad keeps four, so the polygons are the plain quads the method
/// builds then.
pub(crate) fn surface(field: &Tree<f32>, voxel: f64, iso: f64, adaptivity: f64) -> Polygonal {
    let level = iso as f32;
    let (flags, mut slots) = flags::flags(field, &crossing::crossings(field, level), level);
    let adaptive = adaptivity > 1e-7;
    if adaptive {
        merge::merge(field, &flags, &mut slots, level, adaptivity as f32);
    }
    let mut points = points::points(field, &flags, &mut slots, voxel, iso);
    let leaves = polygons::polygons(&flags, &slots);
    if adaptive {
        relax::relax(field, &leaves, &mut points, voxel);
    }
    Polygonal {
        points,
        quads: leaves
            .iter()
            .flat_map(|l| l.quads.iter().copied())
            .collect(),
        triangles: leaves
            .iter()
            .flat_map(|l| l.triangles.iter().copied())
            .collect(),
    }
}
