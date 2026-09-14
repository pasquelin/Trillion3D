use super::*;

pub fn compile(o: &Options, progress: impl Fn(Value) + Sync) -> Result<Value> {
    check(o)?;
    validate_compile_options(o)?;
    let started = Instant::now();
    // FBX/OBJ sources are first turned into a glTF pair inside the cache; everything below reads glTF only.
    let progress = with_ratio(progress);
    let imported;
    let o = if let SourceKind::Importable(inputs) = source_kind(&o.source)? {
        imported = Options {
            source: import::import_source(&inputs, &o.cache, &o.cancelled, &progress)?,
            ..o.clone()
        };
        &imported
    } else {
        o
    };
    let loaded = load_runtime(o)?;
    let bin = loaded.binary.bytes();
    let g = &loaded.g;
    let g_bytes = &loaded.g_bytes;
    let manifest = &loaded.manifest;
    let bin_hash = &loaded.bin_hash;
    let key=hash(serde_json::to_string(&json!({"source":hash(&loaded.manifest_bytes),"binary":bin_hash,"compiler":COMPILER_VERSION,"implementation":implementation_hash(),"scope":o.scope,"budget":o.triangle_budget,"resourceBase":o.resource_base,"simplification":o.simplification,"errorModel":DAG_ERROR_MODEL}))?.as_bytes());
    let mesh_values = values(g, "meshes")?;
    let view_values = values(g, "bufferViews")?;
    let NodeSelection {
        chosen,
        selected_triangles,
        skinned_meshes,
        meshes,
        mesh_map,
    } = select_nodes(o, g)?;
    let BufferPlan {
        accessors,
        jobs,
        access_map,
        views,
        view_map,
        estimated_working_bytes,
    } = plan_buffers(o, g, bin, g_bytes, &meshes)?;
    let (directory, offset, output_views) = copy_source_bin(o, bin, view_values, &views, &key)?;
    let import_ms = started.elapsed().as_secs_f64() * 1000.;
    progress(
        json!({"phase":"import","completed":1,"total":1,"ms":import_ms,"primitives":jobs.len(),"nodes":chosen.len()}),
    );
    let cluster_start = Instant::now();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(o.threads)
        .build()?;
    // Compact per-page index storage is bounded independently from source size. Metadata is retained.
    let primitive_inputs = PrimitiveInputs {
        o,
        g,
        bin,
        mesh_values,
        skinned_meshes: &skinned_meshes,
        mesh_map: &mesh_map,
        progress: &progress,
    };
    let compiled: Vec<CompiledPrimitive> = pool.install(|| {
        jobs.par_iter()
            .map(|(old, primitive)| compile_primitive(&primitive_inputs, old, primitive))
            .collect::<Result<Vec<_>>>()
    })?;
    let (mut primitives, cluster_planes) = compiler_coplanar::split_compiled(compiled);
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
    let result = json!({"schema":cache_format,"formatVersion":cache_format,"compilerVersion":COMPILER_VERSION,"errorModel":DAG_ERROR_MODEL,"status":"ready","key":key,"scope":o.scope,"clusterStrategy":DAG_CLUSTER_STRATEGY,"coplanar":coplanar_report,"selectedTriangles":selected_triangles,"sourceTriangles":manifest["runtime"]["trianglesAcrossNodes"],"selectedNodes":chosen,"totalNodes":manifest["runtime"]["meshNodes"],"autonomousScene":autonomous_scene,"primitives":primitives,"simplification":o.simplification!="none","gpuDriven":false,"metrics":{"importMs":import_ms,"clusterHierarchyPagesMs":cluster_start.elapsed().as_secs_f64()*1000.,"wallMs":started.elapsed().as_secs_f64()*1000.,"sourceMappedBytes":bin.len(),"outputGeometryBytes":offset,"phases":perf::PHASES.report(),"threads":o.threads,"ramBudgetMb":o.ram_budget_mb,"admissionEstimatedBytes":estimated_working_bytes,"peakRssBytes":null,"cpuMs":null,"diskBytesRead":null},"unsupported":unsupported});
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
        let (mut slim, binary) = manifest_binary::split(&result, &templates)?;
        slim["binary"]["sha256"] = json!(hash(&binary));
        atomic(&directory.join(MANIFEST_BINARY_FILE), &binary)?;
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
