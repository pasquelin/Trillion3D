use crate::compiler::pages::record::Deformation;
use crate::compiler::primitive::warn::primitive_event;
use crate::compiler::source::assembly::plan::{AssemblyPlan, RootParent};
use crate::dag::assembly::RootCover;
use crate::*;
use carrying::Carrying;
use reading::{page_data, read_primitive, shaping_of};
use trillion3d_page_codec::bits::grid::PageGrid;
pub(crate) mod carrying;
pub(crate) mod checks;
pub(crate) mod climb;
pub(crate) mod compiled;
pub(crate) mod cost;
pub(crate) mod dag;
pub(crate) mod displaced;
pub(crate) mod pages;
mod reading;
pub(crate) mod stalls;
pub(crate) mod triangles;
pub(crate) mod warn;
/// What the merged layers of a job take: the source meshes a merged layer may take
/// (`Hlod::merged_meshes`), and what the layers take of them (`chain::merged_lods`).
pub(crate) type Merged = BTreeMap<usize, crate::hlod::flatten::merge::Taken>;
pub(crate) struct PrimitiveInputs<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub mesh_values: &'a [Value],
    pub mesh_map: &'a BTreeMap<usize, usize>,
    /// The source meshes whose far levels may be voxels (`VoxelizeOptions::meshes`).
    pub voxelized: &'a BTreeSet<usize>,
    /// The source meshes a merged layer may take (`Hlod::merged_meshes`) and what the merged
    /// layers take of them (`chain::merged_lods`), none for a job with no merged layer: the LODs
    /// of the other meshes are never cut for the merge (`flatten::merge::Lods`).
    pub merged: Option<&'a Merged>,
    /// The fallbacks of the source meshes the fallback meshes stand for, by fallback job: handed on
    /// by the compile of each source (`source/fallback.rs`), which every fallback job runs after.
    pub fallbacks: &'a BTreeMap<(usize, usize), crate::hlod::chain::SourceCover>,
    /// Each source mesh's build settings, by its rank (`MeshBuildOptions::meshes`).
    pub mesh_builds: &'a [crate::compiler::args::mesh_build::MeshBuild],
    /// The displacement each source mesh bakes into its triangles, by its rank, and the maps'
    /// images, read when a primitive that bakes asks for them (`displace::Bakes`).
    pub bakes: &'a crate::displace::Bakes<'a>,
    /// The most triangles a mesh that bakes is tessellated to: what the room allows
    /// (`BufferPlan::bake_cap`).
    pub bake_cap: usize,
    /// Largest world scale under which each source mesh is placed: it is what
    /// brings its bundles' bands to metres.
    pub mesh_scales: &'a BTreeMap<usize, f64>,
    /// The assemblies the load laid out: the primitives that carry their levels and those whose
    /// roots they climb over (`source::assembly::plan`).
    pub assemblies: &'a AssemblyPlan,
    /// The roots the primitives of a first wave handed on (`CompiledPrimitive::cover`), which a
    /// carrier of the second climbs over: none in the first.
    pub covers: &'a BTreeMap<(usize, usize), &'a RootCover>,
    /// Accessors that `plan_buffers` has already validated once, on the same bytes.
    pub validated: &'a BTreeSet<usize>,
    pub progress: &'a (dyn Fn(Value) + Sync),
}
/// A compiled primitive and what later stages read beside it once every primitive is done.
pub(crate) struct CompiledPrimitive {
    pub value: Value,
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    pub collision: Value,
    pub source_cover: crate::hlod::chain::SourceCover,
    /// The groups its far field may draw as voxels.
    pub voxel_seed: crate::voxel::VoxelSeed,
    /// The run of its pages' bytes, which the geometry containers take (`pages/containers.rs`).
    pub page_run: Option<PageRun>,
    /// The roots of its DAG, which an assembly that places it climbs over (`AssemblyPlan::parts`).
    pub cover: Option<RootCover>,
    /// What the levels it carries give the instances that join it: none for a primitive that
    /// carries none.
    pub parents: Vec<RootParent>,
    /// The tree its coarse cut is traced through (`ray_tracing`).
    pub ray_tracing: Option<crate::ray_tracing::PrimitiveTree>,
}
/// Whether the engine draws `material` blended, sorted back to front and never merged with another
/// surface: `alphaMode` `BLEND` as the source authored it, or a transmission, whatever its mode
/// (`transmissive_material`). The one test of a primitive's `pass`.
pub(crate) fn drawn_blended(material: Option<&Value>) -> bool {
    transmissive_material(material)
        || material.is_some_and(|m| AlphaMode::of(m) == AlphaMode::Blend)
}
/// The material primitive `p` names, if any.
fn primitive_material<'g>(g: &'g Value, p: &Value) -> Result<Option<&'g Value>> {
    match p.get("material") {
        Some(material) => {
            Ok(values(g, "materials")?.get(required_index(Some(material), "primitive.material")?))
        }
        None => Ok(None),
    }
}
/// `compile_primitive` of one planned `(mesh, primitive)` job, its error naming the job; none for a
/// carrier the load added that fewer than two instances can join (`Carrying::vacant`): it builds no
/// job, and its instances keep their own roots.
pub(crate) fn compile_job(
    inputs: &PrimitiveInputs<'_>,
    &(m, p): &(usize, usize),
) -> Result<Option<CompiledPrimitive>> {
    compile_primitive(inputs, m, p).map_err(|e| e.within(m, p))
}

/// The largest world scale source mesh `old` is placed at, which brings its bundles' bands to metres.
fn mesh_scale(inputs: &PrimitiveInputs<'_>, old: usize) -> Option<f64> {
    inputs.mesh_scales.get(&old).copied()
}

/// The DAG of the primitive `arrays` describe — positions, the attributes it carries beside them,
/// the corners of its triangles —, built under its mesh's `shaping` and what its `carrying` asks,
/// its ray-tracing tree named by `traced`. Every primitive joins the DAG, a blended one too,
/// transmissive or not: its draw order is restored at runtime from the recorded source rank, so
/// spatial clustering does not scramble the blend order, and the water pass composes its pages
/// over the backdrop as any.
fn build_primitive(
    inputs: &PrimitiveInputs<'_>,
    (old, primitive): (usize, usize),
    arrays: (&[f32], &[&encode::Attribute], &[u32]),
    (deformation, shaping, carrying): (&Deformation, crate::dag::MeshShaping, &Carrying<'_>),
    traced: crate::ray_tracing::Traced,
) -> Result<DagResult> {
    let build = &inputs.mesh_builds[old];
    let scale = mesh_scale(inputs, old);
    let encode = |slice: &[u32], pos: &[f32], carried: &[&_], origin: &[u32], grid: PageGrid| {
        super::pages::record::encode_page(slice, (pos, carried), (deformation, origin), grid)
    };
    // What the merged layers take of it, when one may take it.
    let taken = inputs.merged.and_then(|merged| merged.get(&old).copied());
    let dag = DagInputs {
        taken,
        shaping,
        root_pages: build.root_pages,
        precision: build.precision,
        scale,
        exact: inputs.fallbacks.contains_key(&(old, primitive)),
        traced,
    };
    let assembly = carrying.assembly(inputs.assemblies.takes_roots_of(&(old, primitive)));
    build_dag_primitive(inputs.o, arrays, dag, assembly, &encode)
}

/// What the compile of a primitive has to say: the instances its carrier left out, in the report
/// of its DAG (`clusters.json`, which a warm run replays) and, with the DAG's own warnings and its
/// stage timings, on its progress event.
fn announce(
    progress: &(dyn Fn(Value) + Sync),
    (mesh, primitive): (usize, usize),
    dag: &mut DagResult,
    carrying: &Carrying<'_>,
) {
    carrying.tell(&mut dag.dag_report, &mut dag.warnings);
    let (timings, warnings) = (
        std::mem::take(&mut dag.timings),
        std::mem::take(&mut dag.warnings),
    );
    progress(primitive_event(
        mesh,
        primitive,
        dag.pages.len(),
        timings,
        warnings,
    ));
}

/// Primitive `primitive` of source mesh `old`, compiled; none when it is a carrier the load added
/// that no instance, or only one, can join: it has no triangle of its own and nothing to climb
/// over, builds no job, and tells the instances it left out on its progress event.
pub(crate) fn compile_primitive(
    inputs: &PrimitiveInputs<'_>,
    old: usize,
    primitive: usize,
) -> Result<Option<CompiledPrimitive>> {
    check(inputs.o)?;
    let read = read_primitive(inputs, old, primitive)?;
    let material = primitive_material(inputs.g, read.primitive)?;
    let blended = drawn_blended(material);
    let mesh = *(inputs.mesh_map.get(&old)).ok_or_else(|| invalid("Missing mesh mapping"))?;
    let shaping = shaping_of(inputs, &read, old)?;
    let (deformation, attributes) = page_data(inputs, &read, old)?;
    // The displacement baked into its triangles (`displaced.rs`): its build reads the mesh as made.
    let declared = displaced::Source::declared(read.pos, attributes, read.indices);
    let source = match inputs.fallbacks.get(&(old, primitive)) {
        // A fallback mesh's triangles are its source's fallback, as made.
        Some(cover) => displaced::Source::fallback(cover),
        None => displaced::displace(
            inputs,
            (old, primitive),
            declared,
            (&deformation, read.placeholder),
        )?,
    };
    let shaping = source.shaped(shaping);
    // Every texture set the primitive has, and the bones beside them, which no page reads from there.
    let bones = crate::dag::attributes::bones(&deformation);
    let carried: Vec<&encode::Attribute> = source.attributes.iter().chain(&bones).collect();
    // The instances whose roots climb with this primitive, when it carries an assembly's levels.
    let layout: Vec<(u32, usize)> = carried.iter().map(|a| (a.flag, a.width)).collect();
    let job = (old, primitive);
    let from = (inputs.assemblies, inputs.covers);
    let carrying = Carrying::of(from, &job, (read.placeholder, &layout));
    if carrying.vacant() {
        let event = primitive_event(mesh, primitive, 0, Value::Null, carrying.warnings());
        (inputs.progress)(event);
        return Ok(None);
    }
    let triangles = source.indices.len() / 3;
    let arrays = (&source.positions[..], &carried[..], &source.indices[..]);
    let traced = crate::ray_tracing::Traced {
        mesh: mesh as u32,
        primitive: primitive as u32,
        flags: crate::ray_tracing::material_flags(material, blended),
        cell: 0,
    };
    let mut dag = build_primitive(
        inputs,
        job,
        arrays,
        (&deformation, shaping, &carrying),
        traced,
    )?;
    announce(inputs.progress, (mesh, primitive), &mut dag, &carrying);
    let parents = carrying.parents(old, dag.parents);
    let reach = crate::geometry_page::deform::reach(&deformation, &source.positions[..]);
    // The voxels sample the triangles their seed's ranks index: a baked mesh's, kept for them.
    let mut voxel_seed = dag.voxel_seed;
    if !voxel_seed.groups.is_empty() {
        voxel_seed.traced = source.traced();
    }
    Ok(Some(CompiledPrimitive {
        page_run: dag.page_run,
        cover: dag.cover,
        parents,
        ray_tracing: dag.ray_tracing,
        cluster_planes: dag.cluster_planes,
        collision: dag.collision,
        source_cover: dag.source_cover,
        voxel_seed,
        value: json!({"mesh":mesh,"primitive":primitive,"material":read.primitive.get("material"),"triangles":triangles,"pass":if blended {"clustered-blend"} else {"exact-clusters"},"clusterStrategy":DAG_CLUSTER_STRATEGY,"dag":dag.dag_report,"culling":dag.culling_report,"structure":dag.structure_report,"pages":dag.pages,"deformation":reach}),
    }))
}
