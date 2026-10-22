//! The LODs of a source mesh a merged layer takes (`Lods`): the clusters of its DAG from the finest
//! cut a layer's `Calculate` takes up to its roots, on the vertices they use, cut at the error a
//! screen size stands for (`lod_error`); its fallback, which `Lowest` takes (`fallback`); and the
//! bounds its screen sizes and an automatic atlas side read (`MeshBounds`).
use super::{fallback, Cut, Geometry, LodSelection};
use crate::dag::{DagCluster, DagGroup};
use crate::hlod::chain::cover::{compact_attribute, SourceCover};
use crate::proxy::cut::in_cut;
use crate::simplify::SolveRules;
use crate::Result;
use trillion3d_math::geometry::aabb::{aabb_of, centre};
use trillion3d_math::geometry::sphere::farthest;
use trillion3d_math::vector::vec3::point;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::OPTIONAL;

/// The pixel error a source's LODs are spaced by: a LOD of deviation `d` is drawn from where `d`
/// spans that many pixels across a view of 1920 texels and a quarter turn, `d · 960 / 8` away.
const LOD_PIXEL_ERROR: f64 = 8.0;

/// The object-space error of the LOD a mesh whose bounding sphere has `radius` shows when that
/// sphere spans `screen` of the view: a LOD stands from the distance its deviation spans
/// `LOD_PIXEL_ERROR` pixels, plus the radius — the deviation lies somewhere in the mesh's sphere —,
/// and is drawn while the sphere seen from there spans more than `screen`
/// (`flatten::distance_at`); the coarsest such LOD is the cut at the deviation that distance stands
/// for.
fn lod_error(radius: f64, screen: f64) -> f64 {
    (super::super::distance_at(radius, screen) - radius) * LOD_PIXEL_ERROR
        / (super::super::SCREEN.0 / 2.0)
}

/// A source mesh's bounds in object space, of its level 0: its box (low corner, then high) and
/// the radius of the sphere about that box's centre holding every vertex.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct MeshBounds {
    pub low: [f64; 3],
    pub high: [f64; 3],
    pub radius: f64,
}

impl MeshBounds {
    /// The bounds of the vertices of `positions` the corners `corners` use.
    pub(crate) fn of(positions: &[f32], corners: impl Iterator<Item = u32> + Clone) -> Self {
        let (low, high) = aabb_of(corners.clone().map(|v| point(positions, v)));
        let radius = farthest(
            centre(low, high),
            corners.map(|v| (point(positions, v), 0.0)),
        );
        Self { low, high, radius }
    }
}

/// What the merged layers of a job take of each source (`chain::merged_lods`): the largest screen
/// size of the layers that take the LOD `Calculate` takes it at — the finest cut they take —,
/// none when no layer does, and whether any takes the source's fallback (`Lowest`).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Taken {
    pub calculate: Option<f64>,
    pub lowest: bool,
}

/// A source's LODs the merge may take: when a merged layer takes `Calculate`, the clusters of its
/// DAG from the finest cut it takes at any such layer's screen size up to its roots — the
/// clusters whose parent's error passes it —, on the vertices they use, with every attribute its
/// pages carry on them; its fallback (`fallback`), when a merged layer takes it, after them; and
/// its level 0's bounds. Empty, and not built (`built`), for a source no merged layer takes
/// (`compile_primitive`).
#[derive(Clone, Debug, Default)]
pub(crate) struct Lods {
    /// Whether they were made for a merged layer (`of`).
    built: bool,
    positions: Vec<f32>,
    carried: Vec<Attribute>,
    indices: Vec<u32>,
    /// Per cluster: its own error, its parent's and its corners' range in `indices`.
    clusters: Vec<(f64, f64, std::ops::Range<usize>)>,
    /// The fallback's corners' range in `indices`, on the vertices after the clusters'; empty
    /// when no merged layer takes it.
    fallback: std::ops::Range<usize>,
    /// Its level 0's bounds, which its LODs' screen sizes and an automatic atlas side read.
    pub bounds: MeshBounds,
}

impl Lods {
    /// The LODs of `dag`, whose clusters its `groups` made, on `pos` and the attributes its pages
    /// carry (`carried`, one value set per vertex of `pos`), what `taken` asks of them: from the
    /// cut at the largest of the screen sizes the layers taking `Calculate` name up — every coarser
    /// cut a layer takes lies in them —, and the fallback of a source simplified under `rules` when
    /// a layer takes it.
    pub(crate) fn of(
        (dag, groups): (&[DagCluster], &[DagGroup]),
        (pos, carried): (&[f32], &[&Attribute]),
        taken: Taken,
        rules: SolveRules,
    ) -> Result<Self> {
        let level0 = (dag.iter().filter(|c| c.level == 0)).flat_map(|c| c.indices.iter().copied());
        let bounds = MeshBounds::of(pos, level0);
        let mut joined = Vec::new();
        let mut clusters = Vec::new();
        if let Some(screen) = taken.calculate {
            let finest = lod_error(bounds.radius, screen);
            for cluster in dag.iter().filter(|c| c.parent_error > finest) {
                let start = joined.len();
                joined.extend_from_slice(&cluster.indices);
                clusters.push((cluster.lod_error, cluster.parent_error, start..joined.len()));
            }
        }
        let (mut positions, mut attributes, mut indices) =
            compacted(pos, carried.iter().copied(), &joined);
        let mut lowest = 0..0;
        if taken.lowest {
            let (more_positions, more_attributes, more_indices) =
                fallback::of((dag, groups), (pos, carried), rules)?;
            let first = (positions.len() / 3) as u32;
            lowest = indices.len()..indices.len() + more_indices.len();
            positions.extend(more_positions);
            for (own, more) in attributes.iter_mut().zip(more_attributes) {
                own.values.extend(more.values);
            }
            indices.extend(more_indices.into_iter().map(|v| v + first));
        }
        Ok(Self {
            built: true,
            positions,
            carried: attributes,
            indices,
            clusters,
            fallback: lowest,
            bounds,
        })
    }

    /// Whether the LODs were made for a merged layer: a mesh the merge takes
    /// (`Hlod::merged_meshes`) has them built, whatever its cut takes of them.
    pub(super) fn built(&self) -> bool {
        self.built
    }

    /// The corners of the clusters `cut` takes, by the engine's cut rule (`in_cut`): `Calculate`'s
    /// cut at the error its screen size stands for (`lod_error`), or the fallback `Lowest` takes.
    pub(super) fn selected(&self, (selection, screen): Cut) -> impl Iterator<Item = &[u32]> {
        let error = lod_error(self.bounds.radius, screen);
        let calculated = (self.clusters.iter())
            .filter(move |(own, parent, _)| {
                selection == LodSelection::Calculate && in_cut(*own, *parent, error)
            })
            .map(|(.., range)| &self.indices[range.clone()]);
        let lowest =
            (selection == LodSelection::Lowest).then(|| &self.indices[self.fallback.clone()]);
        calculated.chain(lowest)
    }

    /// The LOD `cut` takes as a cover on the vertices it uses, with every attribute the source
    /// carries.
    pub(super) fn cut(&self, cut: Cut) -> SourceCover {
        let joined: Vec<u32> = self.selected(cut).flatten().copied().collect();
        let (positions, carried, indices) = compacted(&self.positions, &self.carried, &joined);
        SourceCover {
            positions,
            carried,
            indices,
            lods: Self::default(),
        }
    }

    /// The vertices and corners the LOD `cut` takes holds as a cover — at most a vertex per corner,
    /// within the source's own.
    pub(super) fn cut_counts(&self, cut: Cut) -> (usize, usize) {
        let corners: usize = self.selected(cut).map(<[u32]>::len).sum();
        (corners.min(self.positions.len() / 3), corners)
    }
}

/// The vertices of `positions` and `carried` the corners `joined` use, compacted in the order they
/// are first used (`simplify::compact_region`, `compact_attribute`), and `joined` on them.
fn compacted<'a>(
    positions: &[f32],
    carried: impl IntoIterator<Item = &'a Attribute>,
    joined: &[u32],
) -> Geometry {
    let (positions, indices, remap) = crate::simplify::compact_region(positions, joined);
    let carried = (carried.into_iter())
        .map(|attribute| compact_attribute(attribute, &remap))
        .collect();
    (positions, carried, indices)
}

/// The bytes a mesh of `vertices` and `corners` holds, each vertex carrying every attribute a page
/// may: a source's cut.
pub(super) fn mesh_bytes(vertices: usize, corners: usize) -> usize {
    let floats = 3 + OPTIONAL.iter().map(|&(_, width)| width).sum::<usize>();
    4 * (vertices * floats + corners)
}
