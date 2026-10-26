//! The stages of a compile job past its scene, in the order they run: the primitives compiled, their
//! geometry written, then everything built over them until the manifest is published.
use super::finish::finish_job;
use super::primitives::{self, compile_primitives};
use super::products::{stage_products, Products};
use super::scene::Job;
use super::*;
use crate::compiler::primitive::compiled::{
    split_compiled, stage_depth_layers, DepthLayerScene, SplitCompiled,
};
use crate::compiler::primitive::CompiledPrimitive;
use crate::compiler::source::node_transform::Mat4;
use crate::hlod::chain::SourceCover;
use crate::proxy::placement::Placement;
use crate::support::perf::{JobPhases, Phase, Timer};
use crate::texture::TexturePreview;

/// What the job's first stages leave to the rest: the workers it runs on, its buffer plan, where its
/// source binary was copied, and the clock of its phases.
pub(super) struct Built {
    pool: rayon::ThreadPool,
    plan: BufferPlan,
    /// Each node's HLOD layer, read once for every stage that needs it (`Hlod::assignments`).
    assignments: Vec<Assigned>,
    directory: PathBuf,
    output_views: Vec<Value>,
    /// The bytes of the source binary the copy kept.
    offset: usize,
    import_ms: f64,
    cluster_start: Instant,
    /// The primitives that waited for room (`budget/admission.rs`).
    waited: usize,
}

/// Every node's world transform, and the primitives compiled, in the jobs' order.
pub(super) type Produced = (Vec<Mat4>, Vec<CompiledPrimitive>);

/// The primitives of the job as the stages after the geometry read them: validated, their pages
/// written, and beside each what a later stage reads once.
pub(super) struct Written {
    primitives: Vec<Value>,
    geometry_files: Vec<Value>,
    /// Primitives no later stage adds, removes or moves to another mesh: placed once, here.
    placement: Placement,
    cluster_planes: Vec<Vec<Option<crate::coplanar::ClusterPlane>>>,
    collisions: Vec<Value>,
    voxel_seeds: Vec<crate::voxel::VoxelSeed>,
    /// What the levels above each assembly's instances gave them, which the node tables carry.
    parents: AssemblyParents,
}

/// The job planned, its source binary copied, and its primitives compiled on `pool` — narrowed to
/// the workers the plan's budget holds, the first pool let go before the narrower one is built, so
/// the job never has two. The source binary's product comes beside.
pub(super) fn compile_stage(
    job: &Job<'_>,
    (pool, phases, started): (rayon::ThreadPool, &JobPhases, Instant),
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Built, Product, Produced)> {
    let (o, loaded, bin, picked) = (job.o, job.loaded, job.bin, job.picked);
    let (mesh_builds, g) = (job.mesh_builds, &loaded.g);
    let view_values = values(g, "bufferViews")?;
    // The displacement each mesh bakes into its triangles is charged by the plan, its maps read by
    // the first primitive that bakes with them.
    let bakes = primitives::displacements((g, bin, job.image_root), &picked.mesh_map, mesh_builds);
    let plan = plan_buffers(o, g, bin, loaded.g_bytes_len, (&picked.meshes, &bakes))?;
    let pool = if plan.threads < o.threads {
        drop(pool);
        phases.pool(plan.threads)?
    } else {
        pool
    };
    let (directory, output_views, source_bin) =
        copy_source_bin(o, bin, view_values, &plan.views, job.key)?;
    let offset = source_bin.bytes as usize;
    let import_ms = crate::shared_math::elapsed_ms(started);
    progress(
        json!({"phase":"import","completed":1,"total":1,"ms":import_ms,"primitives":plan.jobs.len(),"nodes":picked.chosen.len(),"sharedMeshNodes":picked.shared_nodes,"unsupported":loaded.manifest["unsupported"]}),
    );
    let cluster_start = Instant::now();
    let assignments = o.hlod()?.assignments(g)?;
    let (world, compiled, waited) = compile_primitives(
        (o, g, bin, &pool),
        (&plan.jobs, &plan.working, plan.room),
        (&picked.chosen, &picked.mesh_map, &plan.accessors),
        (mesh_builds, &bakes, plan.bake_cap),
        &assignments,
        progress,
    )?;
    let built = Built {
        pool,
        plan,
        assignments,
        directory,
        output_views,
        offset,
        import_ms,
        cluster_start,
        waited,
    };
    Ok((built, source_bin, (world, compiled)))
}

/// The compiled primitives split, their cluster errors validated, their geometry files written,
/// and the primitives placed in the world; the roots they handed on come beside.
pub(super) fn written(
    o: &Options,
    (world, compiled): Produced,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Written, Vec<SourceCover>)> {
    let parents = AssemblyParents::of(compiled.iter().flat_map(|c| c.parents.iter().copied()));
    let SplitCompiled {
        mut primitives,
        cluster_planes,
        collisions,
        covers,
        voxel_seeds,
        runs,
    } = split_compiled(compiled);
    validate_cluster_errors(&primitives)?;
    let geometry_files = {
        let _t = Timer::new(Phase::PageWrite);
        write_geometry_files(o, &mut primitives, runs)?
    };
    let files = geometry_files.len();
    progress(json!({"phase":"geometry","completed":files,"total":files}));
    let placement = Placement::new(world, &primitives);
    let written = Written {
        primitives,
        geometry_files,
        placement,
        cluster_planes,
        collisions,
        voxel_seeds,
        parents,
    };
    Ok((written, covers))
}

/// The scene the job published, its textures and the products over its geometry staged, the
/// manifest written and published. `source_bin` and `covers` are what the stages before handed on;
/// `provenance` is the scene plugin's.
pub(super) fn finish_compile(
    job: &Job<'_>,
    built: Built,
    (mut written, covers): (Written, Vec<SourceCover>),
    (source_bin, provenance): (Product, Option<Value>),
    (phases, started): (&JobPhases, Instant),
    progress: &(impl Fn(Value) + Sync),
) -> Result<Value> {
    let scene = DepthLayerScene {
        o: job.o,
        g: &job.loaded.g,
        bin: job.bin,
        shown: &job.picked.shown,
        mesh_map: &job.picked.mesh_map,
        cluster_planes: &written.cluster_planes,
        placement: &written.placement,
    };
    let coplanar = stage_depth_layers(&scene, &mut written.primitives, progress)?;
    let (source, source_gltf) = write_source_scene(source_inputs(job, &built))?;
    let stage = texture_stage(job, &built);
    let (mut previews, preview_report) = stage_textures(&built.pool, &stage, progress)?;
    let products = products_of(job, (&built, &written), (&scene, &source, &previews));
    let mut staged = stage_products(&products, covers, (source_bin, source_gltf), progress)?;
    // The world's flattened materials' textures join the scene's: one texture section.
    previews.append(&mut staged.world_previews);
    finish_job(
        (job.o, job.key, &built.directory),
        (staged, (provenance, coplanar, preview_report)),
        (&written.primitives, &written.geometry_files, &previews),
        (
            job.picked.selected_triangles,
            &job.picked.chosen,
            &job.loaded.manifest,
        ),
        (phases, started, built.cluster_start, built.import_ms),
        (
            job.bin,
            built.offset,
            built.plan.threads,
            built.plan.estimated_working_bytes,
            built.waited,
        ),
        progress,
    )
}

/// What the published source scene is written from.
fn source_inputs<'a>(job: &Job<'a>, built: &'a Built) -> SourceSceneInputs<'a> {
    SourceSceneInputs {
        g: &job.loaded.g,
        o: job.o,
        meshes: &job.picked.meshes,
        chosen: &job.picked.chosen,
        mesh_map: &job.picked.mesh_map,
        accessors: &built.plan.accessors,
        access_map: &built.plan.access_map,
        view_map: &built.plan.view_map,
        directory: &built.directory,
        output_views: &built.output_views,
        offset: built.offset,
    }
}

/// What the texture previews are staged from.
fn texture_stage<'a>(job: &Job<'a>, built: &'a Built) -> TextureStage<'a> {
    TextureStage {
        o: job.o,
        reserved_bytes: built.plan.estimated_working_bytes,
        g: &job.loaded.g,
        bin: job.bin,
        image_root: job.image_root,
        used_materials: &job.images.used_materials,
        image_shas: &job.images.shas,
        view_map: &built.plan.view_map,
    }
}

/// What the products are staged from: the job's pool and scene, where they are written, the
/// primitives with what later stages read beside them, and the published `source`.
fn products_of<'a>(
    job: &Job<'a>,
    (built, written): (&'a Built, &'a Written),
    (scene, source, previews): (&'a DepthLayerScene<'a>, &'a Value, &'a [TexturePreview]),
) -> Products<'a> {
    Products {
        pool: &built.pool,
        scene,
        directory: &built.directory,
        image_root: job.image_root,
        reserved: built.plan.estimated_working_bytes,
        mesh_builds: job.mesh_builds,
        primitives: &written.primitives,
        geometry_files: &written.geometry_files,
        collisions: &written.collisions,
        voxel_seeds: &written.voxel_seeds,
        texture_previews: previews,
        scene_nodes: &job.picked.scene_nodes,
        hidden: &job.picked.hidden,
        source,
        assignments: &built.assignments,
        parents: &written.parents,
    }
}
