use super::*;

pub fn compile(o: &Options, progress: impl Fn(Value) + Sync) -> Result<Value> {
    check(o)?;
    validate_compile_options(o)?;
    let started = Instant::now();
    // Tenu jusqu'au retour : deux compilations simultanées d'un même cache s'effaceraient l'une
    // l'autre, chacune purgeant ce que l'autre vient de publier.
    let _lock = CacheLock::acquire(&o.cache)?;
    // Le routeur choisit le pilote du format et lui fait produire la scène intermédiaire ; tout ce
    // qui suit ne lit qu'un glTF, sans savoir de quel format il vient.
    let progress = with_ratio(progress);
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
    let loaded = load_runtime(o, &routed.scene)?;
    let bin = loaded.binary.bytes();
    let g = &loaded.g;
    let g_bytes = &loaded.g_bytes;
    let manifest = &loaded.manifest;
    // L'identité du produit, et non les octets bruts de ce que la source déclare : les mesures d'une
    // conversion en sortent, les images que la scène cite y entrent.
    let key = compiler_identity::cache_key(o, &loaded, &image_root)?;
    let mesh_values = values(g, "meshes")?;
    let view_values = values(g, "bufferViews")?;
    // Une hiérarchie qui se referme sur elle-même est refusée avant toute publication : le parcours
    // des matrices monde part des nœuds sans père, et ne verrait jamais un cycle fermé.
    compiler_nodes::check_acyclic(g)?;
    // L'ensemble des nœuds de la scène rendue, partagé par la sélection, le proxy et les lampes.
    let scene_nodes = compiler_nodes::scene_nodes(g)?;
    let NodeSelection {
        chosen,
        selected_triangles,
        skinned_meshes,
        meshes,
        mesh_map,
    } = select_nodes(o, g, &scene_nodes)?;
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
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(o.threads)
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
        let _t = perf::Timer::new(&perf::PHASES.page_write);
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
    // Les aperçus 16×16 des textures couleur, lus sur le glTF d'entrée et son binaire déjà mappé :
    // un décodage impossible est une ligne de rapport, jamais un échec de compilation.
    let (texture_previews, texture_preview_report) =
        texture_preview::stage_texture_previews(&texture_preview::PreviewInputs {
            o,
            g,
            bin,
            image_root: &image_root,
            meshes: &meshes,
            view_map: &view_map,
        })?;
    // Le proxy résident se construit ici : les coupes grossières sont en main, les aperçus de
    // texture aussi, et c'est le dernier endroit où la hiérarchie de nœuds qui les place existe.
    let scene_proxy = {
        let _t = perf::Timer::new(&perf::PHASES.manifest);
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
    stage_scene_lights(g, &scene_nodes, &directory, &progress)?;
    let autonomous_scene = compiler_autonomous::write_autonomous_scene(
        &directory,
        &source,
        &primitives,
        &output_views,
    )?;
    let mut unsupported = vec!["hard RSS enforcement", "N-API binding"];
    if o.simplification == "none" {
        unsupported.insert(0, "simplification");
    }
    let cache_format = if primitives
        .iter()
        .any(|primitive| primitive["pass"] == "clustered-blend")
    {
        CLUSTERED_BLEND_FORMAT_VERSION
    } else {
        FORMAT_VERSION
    };
    let result = json!({"schema":cache_format,"formatVersion":cache_format,"compilerVersion":COMPILER_VERSION,"errorModel":DAG_ERROR_MODEL,"status":"ready","key":key,"scenePlugin":routed.plugin.map(plugins::provenance),"scope":o.scope,"clusterStrategy":DAG_CLUSTER_STRATEGY,"coplanar":coplanar_report,"texturePreviews":texture_preview_report,"proxy":proxy_descriptor,"selectedTriangles":selected_triangles,"sourceTriangles":manifest["runtime"]["trianglesAcrossNodes"],"selectedNodes":chosen,"totalNodes":manifest["runtime"]["meshNodes"],"autonomousScene":autonomous_scene,"primitives":primitives,"simplification":o.simplification!="none","gpuDriven":false,"metrics":{"importMs":import_ms,"clusterHierarchyPagesMs":shared_math::elapsed_ms(cluster_start),"wallMs":shared_math::elapsed_ms(started),"sourceMappedBytes":bin.len(),"outputGeometryBytes":offset,"phases":perf::PHASES.report(),"threads":o.threads,"ramBudgetMb":o.ram_budget_mb,"admissionEstimatedBytes":estimated_working_bytes,"peakRssBytes":null,"cpuMs":null,"diskBytesRead":null},"unsupported":unsupported});
    // The manifest travels as a small JSON plus a binary of typed-array columns: a reader maps the
    // columns instead of tokenizing tens of megabytes before its first frame.
    {
        let _t = perf::Timer::new(&perf::PHASES.manifest);
        let templates = manifest_binary::Templates {
            binary: MANIFEST_BINARY_FILE,
            page: "../../objects/{sha}.bin",
            geometry: "../../objects/{sha}.bin",
            bundle: "../../objects/{sha}.bin",
        };
        let (mut slim, binary) = manifest_binary::split(&result, &templates, &texture_previews)?;
        slim["binary"]["sha256"] = json!(hash(&binary));
        atomic(&directory.join(MANIFEST_BINARY_FILE), &binary)?;
        atomic(&directory.join(proxy::SCENE_PROXY_FILE), &proxy_bytes)?;
        atomic(
            &directory.join("clusters.json"),
            &serde_json::to_vec(&slim)?,
        )?;
    }
    atomic(
        &o.cache.join("native").join(&o.scope).join("manifest.json"),
        &serde_json::to_vec(
            &json!({"status":"ready","formatVersion":cache_format,"compiler":"native-rust","key":key,"scope":o.scope,"url":format!("{}/clusters.json",key)}),
        )?,
    )?;
    let pruned = prune_cache(o, &key, &result, &progress)?;
    progress(json!({"phase":"complete","completed":1,"total":1,"pruned":pruned}));
    Ok(result)
}
