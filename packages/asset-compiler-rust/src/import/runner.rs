use super::*;

/// Le dossier d'une scène convertie est-il réutilisable tel quel par ce pilote ?
fn reusable(directory: &Path, plugin: &dyn ScenePlugin) -> bool {
    let Ok(bytes) = fs::read(directory.join("manifest.json")) else {
        return false;
    };
    let Ok(existing) = serde_json::from_slice::<Value>(&bytes) else {
        return false;
    };
    existing["status"] == "ready"
        && existing["source"]["plugin"] == crate::plugins::provenance(plugin)
        && directory.join("model.gltf").is_file()
        && directory.join("model.bin").is_file()
}

/// La base de la clé : le pilote, sa version, le nom et les octets de chaque entrée revendiquée.
/// Ce que l'import ouvre en plus — bibliothèques de matériaux, caches — s'y ajoute ensuite.
fn base_key(plugin: &dyn ScenePlugin, inputs: &[PathBuf], hashes: &[String]) -> String {
    let mut material = format!("{}:{}", plugin.name(), plugin.version());
    for (input, digest) in inputs.iter().zip(hashes) {
        material.push('\n');
        material.push_str(input.file_name().and_then(|s| s.to_str()).unwrap_or(""));
        material.push(':');
        material.push_str(digest);
    }
    hash(material.as_bytes())
}

/// Convertit les fichiers revendiqués par `plugin` dans `<cache>/native/imports/<clé>/` et rend ce
/// dossier. La clé hache les octets d'entrée, le nom et la version du pilote, **et tout fichier que
/// la lecture ouvre en plus** — le `.mtl` d'un OBJ en premier : une source inchangée lue par le même
/// pilote se réutilise, un pilote reversionné ou une bibliothèque touchée reconvertit.
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
    let base = base_key(plugin, inputs, &hashes);
    let imports = cache.join("native").join("imports");
    // Le relevé de la conversion précédente donne la clé sans relire la source. Quand il se trompe —
    // une bibliothèque qui change de nom —, la conversion écrit la vraie clé et le corrige.
    let key = external::key(&base, &external::expected(cache, &base));
    let directory = imports.join(&key);
    if reusable(&directory, plugin) {
        progress(json!({"phase":"import-source","step":"reused","key":key,"files":inputs.len()}));
        return Ok(directory);
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
        externals: external::Externals::default(),
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
    let tables = Tables {
        nodes: &importer.nodes,
        meshes: &importer.meshes,
        materials: &importer.materials,
        accessors: &importer.accessors,
        images: &importer.images,
        samplers: &importer.samplers,
        textures: &importer.textures,
        bin: &importer.bin,
    };
    let roots: Vec<usize> = (0..importer.nodes.len()).collect();
    let mut gltf = tables.document(plugin, &roots);
    let lights = &importer.lights;
    if !lights.is_empty() {
        gltf["extensions"] = json!({"KHR_lights_punctual":{"lights":lights}});
        gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
    }
    let gltf_bytes = serde_json::to_vec(&gltf)?;
    progress(
        json!({"phase":"import-source","step":"write","plugin":plugin.name(),"bytes":importer.bin.bytes.len()+gltf_bytes.len()}),
    );
    let (triangles, mesh_nodes) = (importer.triangles, importer.mesh_nodes);
    // La clé définitive, celle des fichiers réellement ouverts : c'est sous elle que la scène vit.
    let externals = importer.externals.drain();
    let key = external::key(&base, &externals);
    let directory = imports.join(&key);
    let external_json = external::manifest(&externals);
    write_scene(
        &directory,
        &gltf_bytes,
        &importer.bin,
        (mesh_nodes, triangles),
        &importer.report,
        || json!({"plugin":crate::plugins::provenance(plugin),"path":source.to_string_lossy(),"files":importer.files,"external":external_json,"key":key,"meshes":importer.meshes.len(),"materials":importer.materials.len(),"images":importer.images.len(),"lights":lights.len(),"importMs":crate::shared_math::elapsed_ms(started)}),
    )?;
    external::write_probe(cache, &base, &externals)?;
    progress(
        json!({"phase":"import-source","step":"complete","key":key,"triangles":triangles,"meshNodes":mesh_nodes,"ms":crate::shared_math::elapsed_ms(started)}),
    );
    Ok(directory)
}
