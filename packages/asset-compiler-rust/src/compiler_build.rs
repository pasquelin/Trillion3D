use super::*;

pub fn compile(o: &Options, progress: impl Fn(Value) + Sync) -> Result<Value> {
    check(o)?;
    validate_compile_options(o)?;
    let started = Instant::now();
    // Les compteurs de phase de ce travail, et d'aucun autre : ils suivent le fil jusqu'au retour.
    let phases = perf::JobPhases::default();
    let _attached = phases.attach();
    // Tenu jusqu'au retour : deux compilations simultanées d'un même cache s'effaceraient l'une
    // l'autre, chacune purgeant ce que l'autre vient de publier.
    let _lock = CacheLock::acquire(o)?;
    // Le routeur choisit le pilote du format et lui fait produire la scène intermédiaire ; tout ce
    // qui suit ne lit qu'un glTF, sans savoir de quel format il vient.
    let progress = with_ratio(progress);
    // Les réponses sur les découpes, lues avant toute conversion (`cutout.rs`).
    let decisions = cutout::load_decisions(&o.cache, &o.source)?;
    let routed: RoutedSource = plugins::scene::prepare_source(o, &progress)?;
    // La racine où les URI relatives d'images se résolvent, lue avant tout déplacement de `o.source`
    // vers le cache : une scène convertie l'y a écrite, ses images sont restées où le pilote les a lues.
    let image_root = routed.scene.images(&o.source);
    let imported;
    let o = if let PreparedScene::Converted { directory, .. } = &routed.scene {
        imported = Options {
            source: directory.clone(),
            ..o.clone()
        };
        &imported
    } else {
        o
    };
    let mut loaded = load_runtime(o, &routed.scene)?;
    let bin = loaded.binary.bytes();
    let g_bytes = &loaded.g_bytes;
    let manifest = &loaded.manifest;
    // Une hiérarchie qui se referme sur elle-même est refusée avant toute publication : le parcours
    // des matrices monde part des nœuds sans père, et ne verrait jamais un cycle fermé.
    compiler_nodes::check_acyclic(&loaded.g)?;
    // L'ensemble des nœuds de la scène rendue, partagé par la sélection, le proxy et les lampes.
    let scene_nodes = compiler_nodes::scene_nodes(&loaded.g)?;
    let NodeSelection {
        chosen,
        selected_triangles,
        skinned_meshes,
        meshes,
        mesh_map,
    } = select_nodes(o, &loaded.g, &scene_nodes)?;
    // Les découpes tranchées passent en masqué avant que le moindre matériau soit lu (`cutout.rs`).
    let cutouts = cutout::apply_decisions(&mut loaded.g, bin, &image_root, &meshes, &decisions)?;
    let g = &loaded.g;
    // L'identité du produit, et non les octets bruts de ce que la source déclare : les mesures d'une
    // conversion en sortent, les images que la scène cite y entrent, les réponses aussi.
    let key = compiler_identity::cache_key(o, &loaded, &image_root, &cutouts.applied)?;
    let mesh_values = values(g, "meshes")?;
    let view_values = values(g, "bufferViews")?;
    let BufferPlan {
        accessors,
        jobs,
        access_map,
        views,
        view_map,
        estimated_working_bytes,
    } = plan_buffers(o, g, bin, g_bytes, &meshes)?;
    let (directory, offset, output_views) = copy_source_bin(o, bin, view_values, &views, &key)?;
    let import_ms = shared_math::elapsed_ms(started);
    progress(
        json!({"phase":"import","completed":1,"total":1,"ms":import_ms,"primitives":jobs.len(),"nodes":chosen.len()}),
    );
    let cluster_start = Instant::now();
    // La grappe naît et meurt avec ce travail : ses ouvriers adoptent ses compteurs, pas ceux d'un voisin.
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(o.threads)
        .start_handler({
            let phases = phases.clone();
            move |_| phases.adopt()
        })
        .build()?;
    // Compact per-page index storage is bounded independently from source size. Metadata is retained.
    // L'échelle monde de chaque maillage est lue avant la boucle : le seuil du proxy est en mètres,
    // et une primitive posée sous une échelle ne peut pas le savoir toute seule.
    let mesh_scales = proxy::mesh_scales(g, &chosen)?;
    let primitive_inputs = PrimitiveInputs {
        o,
        g,
        bin,
        mesh_values,
        skinned_meshes: &skinned_meshes,
        mesh_map: &mesh_map,
        mesh_scales: &mesh_scales,
        scene_triangles: selected_triangles,
        validated: &accessors,
        progress: &progress,
    };
    let compiled: Vec<CompiledPrimitive> = pool.install(|| {
        jobs.par_iter()
            .map(|(old, primitive)| compile_primitive(&primitive_inputs, old, primitive))
            .collect::<Result<Vec<_>>>()
    })?;
    let (mut primitives, cluster_planes, proxy_cuts, proxy_thresholds) =
        compiler_coplanar::split_compiled(compiled);
    let bootstrap_bundles = {
        let _t = perf::Timer::new(perf::Phase::PageWrite);
        share_bootstrap_bundles(o, &mut primitives)?
    };
    progress(json!({"phase":"bootstrap","completed":bootstrap_bundles,"total":bootstrap_bundles}));
    let scene = compiler_coplanar::DepthLayerScene {
        o,
        g,
        bin,
        chosen: &chosen,
        mesh_map: &mesh_map,
        cluster_planes: &cluster_planes,
    };
    let coplanar_report =
        compiler_coplanar::stage_depth_layers(&scene, &mut primitives, &progress)?;
    let source = write_source_scene(SourceSceneInputs {
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
    // La chaîne de mips de chaque texture d'atlas et la feuille des découpes, sur la grappe.
    let (texture_previews, texture_preview_report, cutout_report) = stage_textures(
        &pool,
        &TextureStage {
            o,
            g,
            bin,
            image_root: &image_root,
            meshes: &meshes,
            view_map: &view_map,
            decisions: &decisions,
            applied: &cutouts,
            primitives: &primitives,
        },
        &progress,
    )?;
    // Le proxy résident : coupes grossières et aperçus en main, hiérarchie de nœuds encore là.
    let scene_proxy = {
        let _t = perf::Timer::new(perf::Phase::Manifest);
        proxy::stage_proxy(&proxy::ProxyInputs {
            g,
            chosen: &chosen,
            mesh_map: &mesh_map,
            primitives: &primitives,
            cuts: &proxy_cuts,
            thresholds: &proxy_thresholds,
            previews: &texture_previews,
        })?
    };
    progress(
        json!({"phase":"proxy","completed":1,"total":1,"triangles":scene_proxy.triangle_count(),"nodes":scene_proxy.node_count(),"errorMetres":scene_proxy.error_metres}),
    );
    // Le proxy est un objet de cache à son nom, et non une colonne du sidecar : un manifeste sans
    // lui reste lisible mot pour mot, et ses dizaines de mégaoctets ne retardent pas la première
    // image d'une scène qui ne déclare aucune lampe.
    let proxy_bytes = scene_proxy.encode();
    let proxy_sha = hash(&proxy_bytes);
    let proxy_descriptor =
        scene_proxy.descriptor(proxy::SCENE_PROXY_FILE, &proxy_sha, proxy_bytes.len());
    // Les lampes déclarées par le fichier source, en espace monde, dans le contrat du moteur.
    stage_scene_lights(g, bin, &scene_nodes, &directory, &progress)?;
    let (autonomous_scene, autonomous_refusal) = compiler_autonomous::write_autonomous_scene(
        &directory,
        &source,
        &primitives,
        &output_views,
    )?;
    let unsupported = compiler_format::unsupported(&o.simplification, autonomous_refusal);
    let cache_format = compiler_format::cache_format(&primitives);
    let mut result = json!({"schema":cache_format,"formatVersion":cache_format,"compilerVersion":COMPILER_VERSION,"errorModel":DAG_ERROR_MODEL,"status":"ready","key":key,"scenePlugin":routed.plugin.map(plugins::provenance),"scope":o.scope,"clusterStrategy":DAG_CLUSTER_STRATEGY,"coplanar":coplanar_report,"texturePreviews":texture_preview_report,"cutouts":cutout_report,"proxy":proxy_descriptor,"selectedTriangles":selected_triangles,"sourceTriangles":manifest["runtime"]["trianglesAcrossNodes"],"selectedNodes":chosen,"totalNodes":manifest["runtime"]["meshNodes"],"autonomousScene":autonomous_scene,"primitives":primitives,"simplification":o.simplification!="none","gpuDriven":false,"metrics":{"importMs":import_ms,"clusterHierarchyPagesMs":shared_math::elapsed_ms(cluster_start),"compileMs":shared_math::elapsed_ms(started),"sourceMappedBytes":bin.len(),"outputGeometryBytes":offset,"phaseElapsedMs":phases.report(),"threads":o.threads,"ramBudgetMb":o.ram_budget_mb,"admissionEstimatedBytes":estimated_working_bytes,"peakRssBytes":null,"cpuMs":null,"diskBytesRead":null},"unsupported":unsupported});
    publish(
        &Publication {
            o,
            key: &key,
            directory: &directory,
            cache_format,
            proxy_bytes: &proxy_bytes,
            previews: &texture_previews,
        },
        &result,
    )?;
    // La purge appartient au travail : ses suppressions et sa durée entrent dans ce qu'il annonce.
    // Le manifeste, lui, est déjà écrit — il ne porte donc que `compileMs`, la durée qu'il pouvait
    // connaître, et l'appelant reçoit `wallMs`, prise une fois le cache purgé.
    let prune_start = Instant::now();
    let pruned = prune_cache(o, &key, &result, &texture_previews, &progress)?;
    result["metrics"]["pruneMs"] = json!(shared_math::elapsed_ms(prune_start));
    result["metrics"]["wallMs"] = json!(shared_math::elapsed_ms(started));
    progress(json!({"phase":"complete","completed":1,"total":1,"pruned":pruned}));
    Ok(result)
}
