//! The LODs of a source mesh a merged layer takes (`Lods`): the LOD `Calculate` takes by the
//! layer's screen size (`calculated_lod`) — a glTF mesh has one, its level 0, taken whole —, on the
//! vertices it uses; its fallback, which `Lowest` takes (`fallback`); and the bounds an automatic
//! atlas side reads (`MeshBounds`).
use super::{fallback, Cut, Geometry, LodSelection};
use crate::dag::{DagCluster, DagGroup};
use crate::hlod::chain::cover::{compact_attribute, SourceCover};
use crate::simplify::SolveRules;
use crate::Result;
use trillion3d_math::geometry::aabb::{aabb_of, centre};
use trillion3d_math::geometry::sphere::farthest;
use trillion3d_math::vector::vec3::point;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::OPTIONAL;

/// The screen size a mesh's first LOD is drawn down to by default: a mesh of one LOD is drawn at any
/// size above it.
const LOD0_SCREEN_SIZE: f64 = 2.0;

/// The LOD of a mesh whose LODs are drawn down to `screen_sizes` that a layer's calculated
/// selection takes at `screen`: walking back from the coarsest, the first drawn at more than
/// `screen`, else the first. A glTF mesh has one LOD (`LOD0_SCREEN_SIZE`): its level 0, whatever
/// the layer's screen size.
fn calculated_lod(screen_sizes: &[f64], screen: f64) -> usize {
    (0..screen_sizes.len())
        .rev()
        .find(|&lod| screen_sizes[lod] > screen)
        .unwrap_or(0)
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
    /// The corners of the LOD `Calculate` takes (its level 0) in `indices`; empty when no merged
    /// layer takes it.
    calculated: std::ops::Range<usize>,
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
        if let Some(screen) = taken.calculate {
            let lod = calculated_lod(&[LOD0_SCREEN_SIZE], screen);
            for cluster in dag.iter().filter(|c| c.level == lod) {
                joined.extend_from_slice(&cluster.indices);
            }
        }
        let calculated = 0..joined.len();
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
            calculated,
            fallback: lowest,
            bounds,
        })
    }

    /// Whether the LODs were made for a merged layer: a mesh the merge takes
    /// (`Hlod::merged_meshes`) has them built, whatever its cut takes of them.
    pub(super) fn built(&self) -> bool {
        self.built
    }

    /// The corners `cut` takes: `Calculate`'s LOD (`calculated_lod`: the source's one LOD whatever
    /// the screen size), or the fallback `Lowest` takes.
    pub(super) fn selected(&self, (selection, _): Cut) -> impl Iterator<Item = &[u32]> {
        let calculated =
            (selection == LodSelection::Calculate).then(|| &self.indices[self.calculated.clone()]);
        let lowest =
            (selection == LodSelection::Lowest).then(|| &self.indices[self.fallback.clone()]);
        calculated.into_iter().chain(lowest)
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

    /// The fallback as a cover — the geometry a fallback mesh is built from
    /// (`compiler/source/fallback.rs`) —, none for LODs made without it.
    pub(crate) fn fallback_cover(&self) -> Option<SourceCover> {
        (!self.fallback.is_empty()).then(|| self.cut((LodSelection::Lowest, 0.0)))
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
