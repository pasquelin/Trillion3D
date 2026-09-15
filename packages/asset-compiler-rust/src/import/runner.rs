use super::*;

/// Convertit les fichiers revendiqués par `plugin` dans `<cache>/native/imports/<clé>/` et rend ce
/// dossier. La clé hache les octets d'entrée, le nom et la version du pilote : une source inchangée
/// lue par le même pilote se réutilise, un pilote reversionné reconvertit.
pub fn import_source(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let (inputs, cache) = (request.inputs, request.cache);
    let (cancelled, progress) = (request.cancelled, request.progress);
    let started = std::time::Instant::now();
    let source = inputs
        .first()
        .and_then(|f| {
            if inputs.len() == 1 {
                Some(f.as_path())
            } else {
                f.parent()
            }
        })
        .unwrap_or(Path::new("."));
    // Map every input once: the mapping hashes now and feeds the parser later without a second read.
    let mapped = inputs
        .iter()
        .map(|input| Ok(unsafe { memmap2::MmapOptions::new().map(&fs::File::open(input)?)? }))
        .collect::<Result<Vec<memmap2::Mmap>>>()?;
    let hashes: Vec<String> = mapped.iter().map(|m| hash(m)).collect();
    let mut key_material = format!("{}:{}", plugin.name(), plugin.version());
    for (input, digest) in inputs.iter().zip(&hashes) {
        key_material.push('\n');
        key_material.push_str(input.file_name().and_then(|s| s.to_str()).unwrap_or(""));
        key_material.push(':');
        key_material.push_str(digest);
    }
    let key = hash(key_material.as_bytes());
    let directory = cache.join("native").join("imports").join(&key);
    let manifest_path = directory.join("manifest.json");
    if let Ok(bytes) = fs::read(&manifest_path) {
        if let Ok(existing) = serde_json::from_slice::<Value>(&bytes) {
            if existing["status"] == "ready"
                && existing["source"]["plugin"] == crate::plugins::provenance(plugin)
                && directory.join("model.gltf").is_file()
                && directory.join("model.bin").is_file()
            {
                progress(
                    json!({"phase":"import-source","step":"reused","key":key,"files":inputs.len()}),
                );
                return Ok(directory);
            }
        }
    }
    let mut importer = Importer {
        nodes: Vec::new(),
        meshes: Vec::new(),
        mesh_triangles: Vec::new(),
        materials: Vec::new(),
        accessors: Vec::new(),
        images: Vec::new(),
        samplers: Vec::new(),
        textures: Vec::new(),
        sampler_ids: HashMap::new(),
        lights: Vec::new(),
        bin: Bin {
            bytes: Vec::new(),
            views: Vec::new(),
        },
        report: Report::default(),
        triangles: 0,
        mesh_nodes: 0,
        files: Vec::new(),
        cancelled,
        progress,
    };
    let total = inputs.len();
    for (index, input) in inputs.iter().enumerate() {
        importer.check()?;
        importer.load(input, &mapped[index], &hashes[index], index, total)?;
    }
    if importer.mesh_nodes == 0 {
        return Err(CompilerError::new(
            "IMPORT_EMPTY",
            "No visible mesh instance in the source",
        ));
    }
    let Importer {
        nodes,
        meshes,
        materials,
        accessors,
        images,
        samplers,
        textures,
        lights,
        bin,
        report,
        triangles,
        mesh_nodes,
        files,
        ..
    } = importer;
    let bin_len = bin.bytes.len();
    let (mesh_count, material_count, image_count, light_count) =
        (meshes.len(), materials.len(), images.len(), lights.len());
    let mut gltf = json!({"asset":{"version":"2.0","generator":format!("web-geometry-compiler {} ({})",crate::COMPILER_VERSION,plugin.version())},"scene":0,"scenes":[{"nodes":(0..nodes.len()).collect::<Vec<_>>()}],"nodes":nodes,"meshes":meshes,"materials":materials,"accessors":accessors,"bufferViews":bin.views,"buffers":[{"uri":"model.bin","byteLength":bin_len}]});
    if !images.is_empty() {
        gltf["images"] = json!(images);
        gltf["samplers"] = json!(samplers);
        gltf["textures"] = json!(textures);
    }
    if !lights.is_empty() {
        gltf["extensions"] = json!({"KHR_lights_punctual":{"lights":lights}});
        gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
    }
    let gltf_bytes = serde_json::to_vec(&gltf)?;
    fs::create_dir_all(&directory)?;
    progress(
        json!({"phase":"import-source","step":"write","plugin":plugin.name(),"bytes":bin_len+gltf_bytes.len()}),
    );
    atomic(&directory.join("model.bin"), &bin.bytes)?;
    atomic(&directory.join("model.gltf"), &gltf_bytes)?;
    let mut manifest = runtime_manifest(
        "model.gltf",
        &hash(&gltf_bytes),
        &[("model.bin".to_string(), hash(&bin.bytes))],
        mesh_nodes,
        triangles,
    );
    manifest["runtime"]["bytes"] = json!(gltf_bytes.len());
    manifest["source"] = json!({"plugin":crate::plugins::provenance(plugin),"path":source.to_string_lossy(),"files":files,"key":key,"meshes":mesh_count,"materials":material_count,"images":image_count,"lights":light_count,"importMs":started.elapsed().as_secs_f64()*1000.0});
    manifest["unsupported"] = json!(report.unsupported);
    manifest["notes"] = json!(report.notes);
    atomic(&manifest_path, &serde_json::to_vec_pretty(&manifest)?)?;
    progress(
        json!({"phase":"import-source","step":"complete","key":key,"triangles":triangles,"meshNodes":mesh_nodes,"ms":started.elapsed().as_secs_f64()*1000.0}),
    );
    Ok(directory)
}
