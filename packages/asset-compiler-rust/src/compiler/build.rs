use crate::compiler::source::assembly::plan::AssemblyParents;
use crate::hlod::options::Assigned;
use crate::*;
mod finish;
mod primitives;
mod products;
pub(crate) mod progress;
use {finish::finish_job, primitives::compile_primitives, products::stage_products};
pub fn compile(o: &Options, progress: impl Fn(Value) + Sync) -> Result<Value> {
    check(o)?;
    validate_compile_options(o)?;
    let started = Instant::now();
    // Phase counters of this job, and of no other: they follow the thread until return.
    let phases = crate::support::perf::JobPhases::default();
    let _attached = phases.attach();
    // Held until return: two compilations of one cache would each prune what the other published.
    let _lock = CacheLock::acquire(o)?;
    // Each format driver yields the common glTF intermediate scene.
    let progress = with_ratio(progress);
    let mut decisions = crate::cutout::load_decisions(&o.cache, &o.source)?;
    let routed: RoutedSource = crate::plugins::scene::prepare_source(o, &progress)?;
    // Where relative image URIs resolve, read before a converted scene moves `o.source` away.
    let image_root = routed.scene.images(&o.source);
    let imported;
    let o = if let PreparedScene::Converted { directory, .. }
    | PreparedScene::Extracted { directory, .. } = &routed.scene
    {
        imported = Options {
            source: directory.clone(),
            ..o.clone()
        };
        &imported
    } else {
        o
    };
    let mut loaded = load_runtime(o, &routed.scene)?;
    // The assemblies the job allows are laid out before anything reads the meshes.
    super::source::assembly::expand_assemblies(o, &mut loaded)?;
    let bin = loaded.binary.bytes();
    let manifest = &loaded.manifest;
    let shared_nodes = super::source::mesh_share::share_identical_meshes(&mut loaded.g, bin);
    // A cyclic hierarchy is refused before any publication: the world walk would never see it.
    super::source::nodes::check_acyclic(&loaded.g)?;
    // The rendered scene's nodes, and the hidden ones: compiled (`chosen`), not drawn (`shown`).
    let (scene_nodes, hidden) = super::source::nodes::scene_nodes(&loaded.g)?;
    let super::source::select::NodeSelection {
        chosen,
        selected_triangles,
        meshes,
        mesh_map,
    } = super::source::select::select_nodes(o, &loaded.g, &scene_nodes)?;
    let shown: BTreeSet<usize> = chosen.difference(&hidden).copied().collect();
    // What the cuts of the proxy share its budget over: the meshes, each once, not their instances.
    let unique_triangles = super::source::select::unique_triangles(&loaded.g, &chosen)?;
    // The pool is born and dies with this job: its workers adopt its counters, not a neighbour's.
    let pool = phases.pool(o.threads)?;
    // The materials the compiled meshes use, and the fingerprint of every image read: each
    // taken once, for the key, the cutout candidates and the bake.
    let used_materials = crate::texture::collect::used_materials(&loaded.g, &meshes)?;
    let image_shas = pool.install(|| {
        crate::texture::source::ImageShas::of(&loaded.g, bin, &image_root, &used_materials)
    });
    // Cutouts, answered or measured, go to masked before any material is read (`../cutout.rs`).
    // Their decodes are admitted beside the source the plan will commit: the document parsed
    // and the binary.
    let resident = loaded
        .g_bytes_len
        .saturating_mul(2)
        .saturating_add(bin.len());
    let cutouts = pool.install(|| {
        crate::cutout::apply_decisions(
            (o, resident),
            &mut loaded.g,
            (bin, &image_root),
            (&used_materials, &image_shas),
            &mut decisions,
        )
    })?;
    let g = &loaded.g;
    // Identity of the product, not the raw bytes of what the source declares:
    // conversion timings leave it, images the scene cites enter it, answers too.
    let key = super::cache::identity::cache_key(
        o,
        &loaded,
        (&image_root, &image_shas),
        &cutouts.applied,
    )?;
    // A folder already holding this product is proven, then kept as is (`cache/reuse.rs`).
    if let Some(reused) = super::cache::reuse::reuse(o, &key, &pool, &progress)? {
        return super::cache::reuse::finish(o, &key, reused, started, &loaded.manifest, &progress);
    }
    let view_values = values(g, "bufferViews")?;
    let BufferPlan {
        accessors,
        jobs,
        access_map,
        views,
        view_map,
        estimated_working_bytes,
        threads,
        working,
        room,
    } = plan_buffers(o, g, bin, loaded.g_bytes_len, &meshes)?;
    // Fewer workers than the job's threads where its budget holds no more (`plan_buffers`): the
    // first pool let go before the narrower one is built, so the job never has two.
    let pool = if threads < o.threads {
        drop(pool);
        phases.pool(threads)?
    } else {
        pool
    };
    let (directory, output_views, source_bin) = copy_source_bin(o, bin, view_values, &views, &key)?;
    let offset = source_bin.bytes as usize;
    let import_ms = crate::shared_math::elapsed_ms(started);
    progress(
        json!({"phase":"import","completed":1,"total":1,"ms":import_ms,"primitives":jobs.len(),"nodes":chosen.len(),"sharedMeshNodes":shared_nodes,"unsupported":loaded.manifest["unsupported"]}),
    );
    let cluster_start = Instant::now();
    // Each node's HLOD layer, read once for every stage that needs it (`Hlod::assignments`).
    let assignments = o.hlod()?.assignments(g)?;
    let (world, mesh_scales, compiled, waited) = compile_primitives(
        (o, g, bin, &image_root, &pool),
        (&jobs, &working, room),
        (&chosen, &mesh_map, unique_triangles, &accessors),
        &assignments,
        &progress,
    )?;
    // What the levels above each assembly's instances gave them, which the node tables carry.
    let parents = AssemblyParents::of(compiled.iter().flat_map(|c| c.parents.iter().copied()));
    let super::primitive::compiled::SplitCompiled {
        mut primitives,
        cluster_planes,
        proxy_cuts,
        proxy_thresholds,
        collisions,
        covers,
        voxel_seeds,
        runs,
    } = super::primitive::compiled::split_compiled(compiled);
    validate_cluster_errors(&primitives)?;
    let geometry_files = {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::PageWrite);
        write_geometry_files(o, &mut primitives, runs)?
    };
    let files = geometry_files.len();
    progress(json!({"phase":"geometry","completed":files,"total":files}));
    // Primitives no later stage adds, removes or moves to another mesh: placed once, here.
    let placement = crate::proxy::placement::Placement::new(world, &primitives);
    let scene = super::primitive::compiled::DepthLayerScene {
        o,
        g,
        bin,
        shown: &shown,
        mesh_map: &mesh_map,
        cluster_planes: &cluster_planes,
        placement: &placement,
    };
    let coplanar_report =
        super::primitive::compiled::stage_depth_layers(&scene, &mut primitives, &progress)?;
    let (source, source_gltf) = write_source_scene(SourceSceneInputs {
        g,
        o,
        meshes: &meshes,
        chosen: &chosen,
        mesh_map: &mesh_map,
        accessors: &accessors,
        access_map: &access_map,
        view_map: &view_map,
        directory: &directory,
        output_views: &output_views,
        offset,
    })?;
    let (texture_previews, texture_preview_report, cutout_report) = stage_textures(
        &pool,
        &TextureStage {
            o,
            reserved_bytes: estimated_working_bytes,
            g,
            bin,
            image_root: &image_root,
            used_materials: &used_materials,
            image_shas: &image_shas,
            view_map: &view_map,
            decisions: &decisions,
            applied: &cutouts,
            primitives: &primitives,
        },
        &progress,
    )?;
    let mut staged = stage_products(
        (
            &pool,
            &scene,
            &directory,
            &image_root,
            estimated_working_bytes,
        ),
        (&voxel_seeds, &mesh_scales),
        (&primitives, &geometry_files, covers, &collisions),
        (&proxy_cuts, &proxy_thresholds, &texture_previews),
        (&scene_nodes, &hidden, &source, &assignments, &parents),
        (source_bin, source_gltf),
        &progress,
    )?;
    // The world's flattened materials' textures join the scene's: one texture section.
    let mut texture_previews = texture_previews;
    texture_previews.append(&mut staged.world_previews);
    let reports = (
        routed.plugin.map(crate::plugins::provenance),
        coplanar_report,
        texture_preview_report,
        cutout_report,
    );
    finish_job(
        (o, &key, &directory),
        (staged, reports),
        (&primitives, &geometry_files, &texture_previews),
        (selected_triangles, &chosen, manifest),
        (&phases, started, cluster_start, import_ms),
        (bin, offset, threads, estimated_working_bytes, waited),
        &progress,
    )
}
