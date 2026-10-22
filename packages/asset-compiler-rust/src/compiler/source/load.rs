pub(crate) mod compressed;
use crate::compiler::cache::format::SOURCE_FORMAT_VERSION;
use crate::*;

pub fn runtime_manifest(
    file: &str,
    sha256: &str,
    sidecars: &[(String, String)],
    mesh_nodes: usize,
    triangles: usize,
) -> Value {
    let sidecars: Vec<Value> = sidecars
        .iter()
        .map(|(file, sha)| json!({"file":file,"sha256":sha}))
        .collect();
    json!({"status":"ready","formatVersion":SOURCE_FORMAT_VERSION,"runtime":{"file":file,"sha256":sha256,"sidecars":sidecars,"trianglesAcrossNodes":triangles,"meshNodes":mesh_nodes}})
}
pub(crate) fn load_model_file(
    dir: &Path,
    name: &str,
    declared: Option<Value>,
    budget: &crate::compiler::source::load::compressed::Budget<'_>,
) -> Result<RuntimeSource> {
    if !is_safe_source_name(name) {
        return Err(invalid("manifest.runtime.file is required"));
    }
    if let Some(manifest) = &declared {
        validate_manifest(manifest)?;
    }
    let file_bytes = map_source(&dir.join(name))?;
    let source_hash = hash(&file_bytes);
    if let Some(manifest) = &declared {
        let expected = manifest
            .pointer("/runtime/sha256")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("manifest.runtime.sha256 is required"))?;
        if source_hash != expected {
            return Err(CompilerError::new(
                "SOURCE_HASH_MISMATCH",
                "glTF hash differs from manifest",
            ));
        }
    }
    // Bytes of the glTF itself: a GLB's BIN chunk is charged once, as the job's binary.
    let Document {
        mut g,
        binary,
        mut offsets,
        sidecars,
        json_bytes: g_bytes_len,
    } = read_document(dir, file_bytes, declared.as_ref())?;
    let binary = crate::compiler::source::load::compressed::meshopt_views(
        &mut g,
        binary,
        &mut offsets,
        budget,
    )?;
    flatten_buffer_views(&mut g, &offsets, binary.bytes().len())?;
    let binary =
        crate::compiler::source::load::compressed::draco_primitives(&mut g, binary, budget)?;
    expand_gpu_instances(&mut g, binary.bytes())?;
    let binary = crate::compiler::source::spline::bend_spline_meshes(&mut g, binary)?;
    // A binary still mapped is one sidecar no codec rewrote — a rewrite owns its bytes: its digest
    // was taken when it was read (`concat_gltf_buffers`), and is not taken twice. A GLB's BIN chunk,
    // buffers joined or decoded views are hashed here, the only time.
    let bin_hash = match (&binary, sidecars.as_slice()) {
        (Binary::Mapped(_), [(_, digest)]) => digest.clone(),
        _ => hash(binary.bytes()),
    };
    let manifest = match declared {
        Some(manifest) => manifest,
        None => {
            let (mesh_nodes, triangles) = source_stats(&g)?;
            runtime_manifest(name, &source_hash, &sidecars, mesh_nodes, triangles)
        }
    };
    Ok(RuntimeSource {
        manifest,
        g,
        g_bytes_len,
        binary,
        bin_hash,
    })
}
/// Loads the intermediate scene the router prepared. A converted scene has moved
/// `o.source` onto its cache folder: it is then re-read through its manifest, like
/// a source that already carries one.
pub(crate) fn load_runtime(o: &Options, prepared: &PreparedScene) -> Result<RuntimeSource> {
    let budget = crate::compiler::source::load::compressed::Budget {
        limit: o.ram_budget_bytes(),
        cancelled: &o.cancelled,
    };
    match prepared {
        PreparedScene::InPlace(name) if o.source.is_file() => load_model_file(
            crate::compiler::source::safe_path::parent_or_dot(&o.source),
            name,
            None,
            &budget,
        ),
        // An extracted scene has moved `o.source` onto its directory, like a converted one.
        PreparedScene::InPlace(name) | PreparedScene::Extracted { file: name, .. } => {
            load_model_file(&o.source, name, None, &budget)
        }
        PreparedScene::Manifest | PreparedScene::Converted { .. } => {
            let manifest: Value =
                serde_json::from_slice(&fs::read(o.source.join(crate::MANIFEST_POINTER))?)?;
            validate_manifest(&manifest)?;
            let gltf_file = manifest
                .get("runtime")
                .and_then(|r| r.get("file"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| invalid("manifest.runtime.file is required"))?;
            load_model_file(&o.source, &gltf_file, Some(manifest), &budget)
        }
    }
}
