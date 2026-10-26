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
/// The file's hash `source_hash` against the one a declared manifest holds.
fn check_declared_hash(manifest: &Value, source_hash: &str) -> Result<()> {
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
    Ok(())
}

/// The manifest a source is read under: the declared one, else one made of the file `name` read
/// (its hash `source_hash`, its `sidecars`) and of the scene `g` it holds.
fn manifest_of(
    declared: Option<Value>,
    g: &Value,
    (name, source_hash, sidecars): (&str, &str, &[(String, String)]),
) -> Result<Value> {
    match declared {
        Some(manifest) => Ok(manifest),
        None => {
            let (mesh_nodes, triangles) = source_stats(g)?;
            Ok(runtime_manifest(
                name,
                source_hash,
                sidecars,
                mesh_nodes,
                triangles,
            ))
        }
    }
}

/// The glTF extensions a source may require: every one a reader of the compiler implements.
const IMPLEMENTED_EXTENSIONS: &[&str] = &[
    "KHR_lights_punctual",
    "KHR_materials_anisotropy",
    "KHR_materials_clearcoat",
    "KHR_materials_dispersion",
    "KHR_materials_emissive_strength",
    "KHR_materials_ior",
    "KHR_materials_iridescence",
    "KHR_materials_sheen",
    "KHR_materials_specular",
    "KHR_materials_transmission",
    "KHR_materials_unlit",
    "KHR_materials_volume",
    "KHR_mesh_quantization",
    "KHR_draco_mesh_compression",
    "KHR_implicit_shapes",
    "KHR_node_visibility",
    "KHR_physics_rigid_bodies",
    "KHR_texture_transform",
    "EXT_materials_bump",
    "EXT_mesh_gpu_instancing",
    "EXT_meshopt_compression",
    "EXT_texture_avif",
    "EXT_texture_webp",
];

/// The names `g` lists under `key` that no reader implements.
fn unimplemented_extensions<'a>(g: &'a Value, key: &str) -> Vec<&'a str> {
    let listed = g.get(key).and_then(Value::as_array);
    (listed.into_iter().flatten())
        .filter_map(Value::as_str)
        .filter(|name| !IMPLEMENTED_EXTENSIONS.contains(name))
        .collect()
}

/// The reason an extension used and not implemented is counted under in the import report.
const EXTENSION_NOT_IMPLEMENTED: &str = "extension-not-implemented";

/// A version number as glTF writes it, a string or a number.
fn version_of(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::String(text) => text.parse().ok(),
        other => other.as_f64(),
    }
}

/// Refuses a document of glTF version above 2.x or one that requires an extension no reader
/// implements; returns how many extensions it uses that none implements, which it may do without.
fn check_requirements(g: &Value) -> Result<usize> {
    let asset = g.get("asset");
    if let Some(min) = version_of(asset.and_then(|a| a.get("minVersion"))) {
        if min > 2.0 {
            return Err(CompilerError::new(
                "UNSUPPORTED_VERSION",
                "This importer supports glTF version 2.0 (or compatible) assets",
            ));
        }
    } else if version_of(asset.and_then(|a| a.get("version"))).is_some_and(|v| v < 2.0) {
        return Err(CompilerError::new(
            "UNSUPPORTED_VERSION",
            "This importer supports glTF asset version 2.0 or later",
        ));
    }
    let required = unimplemented_extensions(g, "extensionsRequired");
    if !required.is_empty() {
        return Err(CompilerError::new(
            "UNSUPPORTED_EXTENSION",
            format!(
                "Not all required extensions are supported. (Unsupported extensions: {})",
                required.join(", ")
            ),
        ));
    }
    Ok(unimplemented_extensions(g, "extensionsUsed").len())
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
        check_declared_hash(manifest, &source_hash)?;
    }
    // Bytes of the glTF itself: a GLB's BIN chunk is charged once, as the job's binary.
    let Document {
        mut g,
        binary,
        mut offsets,
        sidecars,
        json_bytes: g_bytes_len,
    } = read_document(dir, file_bytes, declared.as_ref())?;
    let skipped_extensions = check_requirements(&g)?;
    let binary = crate::compiler::source::load::compressed::meshopt_views(
        &mut g,
        binary,
        &mut offsets,
        budget,
    )?;
    flatten_buffer_views(&mut g, &offsets, binary.bytes().len())?;
    let binary =
        crate::compiler::source::load::compressed::draco_primitives(&mut g, binary, budget)?;
    let (binary, left_out) =
        crate::compiler::source::primitive_modes::triangulate_primitives(&mut g, binary, budget)?;
    expand_gpu_instances(&mut g, binary.bytes())?;
    let (binary, bent) =
        crate::compiler::source::spline::bend_spline_meshes(&mut g, binary, budget)?;
    // A binary still mapped is one sidecar no codec rewrote — a rewrite owns its bytes: its digest
    // was taken when it was read (`concat_gltf_buffers`), and is not taken twice. A GLB's BIN chunk,
    // buffers joined or decoded views are hashed here, the only time.
    let bin_hash = match (&binary, sidecars.as_slice()) {
        (Binary::Mapped(_), [(_, digest)]) => digest.clone(),
        _ => hash(binary.bytes()),
    };
    let mut manifest = manifest_of(declared, &g, (name, &source_hash, &sidecars))?;
    for (reason, count) in [
        (
            crate::compiler::source::primitive_modes::NOT_IMPORTED,
            left_out,
        ),
        (EXTENSION_NOT_IMPLEMENTED, skipped_extensions),
    ] {
        if count > 0 {
            crate::compiler::source::assembly::tell(&mut manifest, reason, count);
        }
    }
    Ok(RuntimeSource {
        manifest,
        g,
        g_bytes_len,
        binary,
        bin_hash,
        bent,
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
