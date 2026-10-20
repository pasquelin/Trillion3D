use super::*;
use crate::plugins::scene::SceneOutput;

/// Can this driver reuse a converted scene folder as-is?
fn reusable(directory: &Path, plugin: &dyn ScenePlugin) -> bool {
    let Ok(bytes) = fs::read(directory.join(crate::MANIFEST_POINTER)) else {
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

/// Folder from which the reader resolves files the source cites.
fn source_root(inputs: &[PathBuf]) -> PathBuf {
    inputs
        .first()
        .and_then(|input| input.parent())
        .unwrap_or(Path::new("."))
        .to_path_buf()
}

/// Converts the files claimed by `plugin` into `<cache>/native/imports/<key>/` and
/// returns that folder. The key hashes the input bytes, the driver name and
/// version, **and every extra file the read opens** — an OBJ's `.mtl` first: an
/// unchanged source read by the same driver is reused; a re-versioned driver or a
/// touched library reconverts.
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
        .map(|input| crate::map_source(input))
        .collect::<Result<Vec<memmap2::Mmap>>>()?;
    // Key base: the driver, its version, the name, size and digest of each claimed input — the
    // one rule of every driver (`SceneTables::read_file`). What import opens besides that —
    // material libraries, caches — is added next.
    let mut scene = SceneTables::new(plugin);
    for (input, bytes) in inputs.iter().zip(&mapped) {
        let name = input.file_name().and_then(|s| s.to_str()).unwrap_or("");
        scene.read_file(name, bytes.len(), &hash(bytes));
    }
    let base = scene.key();
    // Folder that resolves the source's dependencies: it, not the input bytes
    // alone, says which external files the read will open.
    let root = source_root(inputs);
    let root = fs::canonicalize(&root).unwrap_or(root);
    let imports = crate::imports_dir(cache);
    // The previous conversion's record gives the key without re-reading the source.
    // When it is wrong — a library that changes name — conversion writes the true
    // key and corrects it.
    let key = external::key(&base, &external::expected(cache, &base, &root));
    let directory = imports.join(&key);
    if reusable(&directory, plugin) {
        progress(json!({"phase":"import-source","step":"reused","key":key,"files":inputs.len()}));
        return Ok(directory);
    }
    let mut importer = Importer {
        scene,
        skins: Vec::new(),
        animations: Vec::new(),
        externals: external::Externals::default(),
        cancelled,
        progress,
    };
    let total = inputs.len();
    for (index, input) in inputs.iter().enumerate() {
        importer.check()?;
        importer.load(input, &mapped[index], index, total)?;
    }
    let (mesh_nodes, triangles) = importer.scene.stats();
    if mesh_nodes == 0 {
        return Err(CompilerError::new(
            "IMPORT_EMPTY",
            "No visible mesh instance in the source",
        ));
    }
    let tables = borrowed_tables!(importer.scene);
    let mut gltf = tables.document(plugin, &importer.scene.roots()?);
    let lights = &importer.scene.lights;
    crate::import::attach_lights(&mut gltf, lights);
    for (field, table) in [
        ("skins", &importer.skins),
        ("animations", &importer.animations),
    ] {
        if !table.is_empty() {
            gltf[field] = json!(table);
        }
    }
    let gltf_bytes = serde_json::to_vec(&gltf)?;
    progress(
        json!({"phase":"import-source","step":"write","plugin":plugin.name(),"bytes":importer.scene.bin.bytes.len()+gltf_bytes.len()}),
    );
    // The definitive key, that of the files actually opened: the scene lives under it.
    let externals = importer.externals.drain();
    let key = external::key(&base, &externals);
    let directory = imports.join(&key);
    let external_json = external::manifest(&externals);
    write_scene(
        &directory,
        &gltf_bytes,
        &importer.scene.bin,
        (mesh_nodes, triangles),
        &importer.scene.report,
        || json!({"plugin":crate::plugins::provenance(plugin),"path":source.to_string_lossy(),"files":importer.scene.files,"external":external_json,"key":key,"meshes":importer.scene.meshes.len(),"materials":importer.scene.materials.len(),"images":importer.scene.images.len(),"lights":lights.len(),"importMs":crate::shared_math::elapsed_ms(started)}),
    )?;
    external::write_probe(cache, &base, &root, &externals)?;
    progress(
        json!({"phase":"import-source","step":"complete","key":key,"triangles":triangles,"meshNodes":mesh_nodes,"ms":crate::shared_math::elapsed_ms(started)}),
    );
    Ok(directory)
}
