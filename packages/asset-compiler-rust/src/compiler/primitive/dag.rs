use super::climb::{Assembly, Role};
use crate::dag::assembly::{Parent, RootCover};
use crate::dag::DagStrategy;
use crate::hlod::chain::SourceCover;
use crate::ray_tracing::{primitive_tree, PrimitiveTree, Traced};
use crate::*;
use paged::{page_dag, Paged};
use read::{read_dag, Read};
use trillion3d_page_codec::bits::grid::PageGrid;
mod paged;
mod read;
pub(crate) struct DagResult {
    pub pages: Vec<Value>,
    /// The plane each cluster lies in, by page index, when it lies in one. Read by the coplanar
    /// stage once every primitive is compiled; never written to the cache on its own.
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    /// The run of its pages' bytes (`pages.rs`), none without pages.
    pub page_run: Option<PageRun>,
    pub dag_report: Value,
    /// Stage milliseconds, reported only in progress events so caches remain reproducible.
    pub timings: Value,
    /// What the DAG has to complain about, named, also told on the progress event.
    pub warnings: Vec<Value>,
    pub culling_report: Value,
    pub structure_report: Value,
    /// The primitive's cooked collision (`physics_cook::cook_primitive`).
    pub collision: Value,
    /// Its level-0 geometry, which the world HLOD merges (`hlod::chain::stage_world_roots`).
    pub source_cover: SourceCover,
    /// The groups its far field may draw as voxels (`voxel`).
    pub voxel_seed: crate::voxel::VoxelSeed,
    /// The roots of its DAG, when an assembly climbs over them (`Assembly::cover`).
    pub cover: Option<RootCover>,
    /// The group that replaces each instance's root, when it carries an assembly's levels
    /// (`Assembly::instances`), in the order of the instances.
    pub parents: Vec<Option<Parent>>,
    /// The tree its coarse cut is traced through (`ray_tracing`), none when the cut holds no
    /// triangle.
    pub ray_tracing: Option<PrimitiveTree>,
}
/// What a primitive's DAG is built under.
pub(crate) struct DagInputs {
    /// What the merged layers take of its source, none when none does: a blended primitive's
    /// source cover merges into the world's HLOD as any (`SourceCover::of`), with the LODs it
    /// names (`Lods::of`).
    pub taken: Option<crate::hlod::flatten::merge::Taken>,
    /// How its mesh keeps its shape as its DAG is built, and what its finest level keeps
    /// (`dag::MeshShaping`).
    pub shaping: crate::dag::MeshShaping,
    /// Its first streaming pages at least are its root pages (`root_page_count`).
    pub root_pages: usize,
    /// What its mesh's build names of its pages' grid (`meshBuild`'s position, normal and tangent
    /// precisions), the grid itself following its finest clusters unless named
    /// (`geometry_page::quant::page_grid`).
    pub precision: trillion3d_page_codec::bits::grid::Precision,
    /// The largest world scale its mesh is placed at, which brings its bundles' bands to metres
    /// (`lay_bundles`).
    pub scale: Option<f64>,
    /// Whether its clusters are its level 0 alone, every one a root, whatever the job's strategy:
    /// the mesh is drawn whole at every distance (a fallback mesh, `source/fallback.rs`).
    pub exact: bool,
    /// What names its tree for ray tracing and the flags of its material (`primitive_tree`).
    pub traced: Traced,
}
/// How a page is encoded: the corners of its cluster, the positions and the attributes they index,
/// the vertex each placed one deforms as, and the grid it lies on.
pub(crate) type EncodePage<'e> = &'e (dyn Fn(
    &[u32],
    &[f32],
    &[&encode::Attribute],
    &[u32],
    PageGrid,
) -> Result<crate::compiler::pages::record::EncodedPage>
         + Sync);

impl DagResult {
    /// What the stages of a primitive's DAG leave, with the roots it keeps for the assemblies that
    /// place it (`cover`), the group that replaces each instance's root (`parents`) and the stage
    /// milliseconds (`timings`), and the tree of its cut (`ray_tracing`).
    fn of(
        (read, paged): (Read, Paged),
        (cover, parents): (Option<RootCover>, Vec<Option<Parent>>),
        ray_tracing: Option<PrimitiveTree>,
        timings: Value,
    ) -> Self {
        Self {
            pages: paged.pages,
            cluster_planes: paged.cluster_planes,
            page_run: paged.page_run,
            dag_report: read.dag_report,
            timings,
            warnings: read.warnings,
            culling_report: paged.culling_report,
            structure_report: paged.structure_report,
            collision: paged.collision,
            source_cover: read.source_cover,
            voxel_seed: read.voxel_seed,
            cover,
            parents,
            ray_tracing,
        }
    }
}

/// The DAG of the primitive `pos`, `carried` and `index_values` describe, its pages and what the
/// later stages read of it, built under `inputs` and under what an assembly asks (`Assembly`,
/// `Role`): a primitive that carries the levels above instances is built over them.
pub(crate) fn build_dag_primitive(
    o: &Options,
    (pos, carried, index_values): (&[f32], &[&encode::Attribute], &[u32]),
    inputs: DagInputs,
    assembly: Assembly<'_>,
    encode_packed: EncodePage<'_>,
) -> Result<DagResult> {
    let strategy = match inputs.exact {
        true => DagStrategy::ExactClusters,
        false => DagStrategy::named(&o.simplification),
    };
    let shaping = &inputs.shaping;
    let settings = crate::dag::DagSettings {
        strategy,
        rules: shaping.rules(),
        drop_near_collapsed: shaping.drop_near_collapsed,
        input: shaping.input,
    };
    let attributes = crate::dag::DagAttributes { carried };
    let mut laps = crate::support::perf::Laps::start();
    let role = Role::of(!assembly.instances.is_empty(), shaping, inputs.taken);
    let climbed = assembly.build(o, (pos, attributes, index_values), settings)?;
    // `built.indices`: the source's triangles as the DAG read them, every corner at its exact
    // weld's first vertex — what level 0 partitions, the collider cooks and the voxels seed from —,
    // and `built.triangle_source` each one's rank among the source's, which the voxels sample by.
    let (mut built, parents) = (climbed.build, climbed.parents);
    laps.lap("dagMs");
    let (pos, carried) = crate::dag::Grown::arrays(&built.grown, pos, attributes);
    checks::check_dag(&built.clusters, &built.indices)?;
    let cover = match assembly.cover {
        true => RootCover::of(&built.clusters, pos, &carried),
        false => None,
    };
    let own_collider = role.own_collider;
    let read = read_dag(
        (strategy, role),
        inputs.precision,
        (&mut built.clusters, &mut built.groups),
        (pos, &carried, &built.indices, &built.triangle_source),
        (&built.tallies, &built.stalls),
    )?;
    laps.lap("readMs");
    // The cut is taken of the clusters as the trim left them: the ranks the pages carry.
    let ray_tracing = primitive_tree(pos, &carried, &built.clusters, inputs.traced)?;
    laps.lap("rayTracingMs");
    let to_page = (read.grid, inputs.root_pages, inputs.scale, own_collider);
    let paged = page_dag(
        (o, &mut laps),
        (&built, pos, &carried),
        to_page,
        encode_packed,
    )?;
    laps.lap("reportMs");
    Ok(DagResult::of(
        (read, paged),
        (cover, parents),
        ray_tracing,
        laps.report(),
    ))
}
