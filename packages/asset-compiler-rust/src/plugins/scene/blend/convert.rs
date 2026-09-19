//! From the Blender file to the intermediate scene written in the cache.
//!
//! The walk is that of the file, bounded to the active scene: each mesh-type `OB` block a
//! collection of that scene holds becomes a node, each `ME` block a glTF mesh, poured once —
//! several objects that share a mesh therefore share the same one, and differ only by their
//! matrix. A root node carries the axis conversion, Blender working Z-up and glTF Y-up: one
//! exact matrix, rather than retouching every vertex.
use super::*;

/// Axis conversion, column by column: x stays x, y becomes z, z becomes -y.
const Z_UP_TO_Y_UP: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// Reads the file and writes its conversion into the cache. Nothing is written next to the source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let source = single(request.inputs)?;
    // The ceiling applies first to what is read from disk: a file larger than it does not fit any
    // more once unpacked, and it is not loaded into memory to discover that.
    let on_disk = usize::try_from(fs::metadata(source)?.len()).unwrap_or(usize::MAX);
    envelope::within(on_disk, MAX_BYTES)?;
    let raw = fs::read(source)?;
    let digest = hash(&raw);
    let file = BlendFile::open(&raw, MAX_BYTES)?;
    (request.progress)(json!({
        "phase":"import-source","step":"scan","plugin":NAME,
        "blendVersion":file.version,"blocks":file.blocks.len(),
    }));
    let root = image_root(request.source);
    let mut scene = walker::Scene {
        out: Out::default(),
        images: Images::default(),
        materials: HashMap::new(),
        meshes: HashMap::new(),
        root: &root,
        cancelled: request.cancelled,
    };
    scene.out.nodes.push(json!({
        "name": name_of(source), "matrix": Z_UP_TO_Y_UP, "children": [],
    }));
    scene.out.roots.push(0);
    let scenes = file.of(*b"SC\0\0").count();
    if scenes > 1 {
        scene.out.count("scenes", scenes);
        scene.out.report.add_count("blend-extra-scenes", scenes - 1);
    }
    let active = active::objects(&file);
    let mut outside = 0;
    for block in file.of(*b"OB\0\0") {
        if request.cancelled.load(Ordering::Relaxed) {
            return Err(cancel::refusal());
        }
        let Some(object) = file.view(block) else {
            continue;
        };
        if active
            .as_ref()
            .is_some_and(|held| !held.contains(&block.old))
        {
            outside += 1;
            continue;
        }
        scene.object(&object)?;
    }
    scene
        .out
        .report
        .add_count("blend-object-outside-scene", outside);
    // The key holds the digest of the file read: an unchanged file is rewritten identically, at
    // the same place.
    scene.out.key_material = format!("{}:{}\n{digest}", plugin.name(), plugin.version());
    scene.out.files = json!([{"file": name_of(source), "bytes": raw.len(), "sha256": digest}]);
    super::finish(
        scene.out,
        request,
        plugin,
        source,
        started,
        &format!("blend: {} carries no mesh object", source.display()),
    )
}

/// The file to compile. Two `.blend` in a directory is an ambiguity the driver does not settle
/// in the caller's place.
fn single(inputs: &[PathBuf]) -> Result<&Path> {
    match inputs {
        [one] => Ok(one.as_path()),
        [] => Err(CompilerError::new(
            "SOURCE_FORMAT_UNKNOWN",
            "blend: no .blend file in this source",
        )),
        many => Err(CompilerError::new(
            "SOURCE_FORMAT_AMBIGUOUS",
            format!(
                "blend: this directory carries {} .blend files ({}); name the one to compile by giving its file as the source",
                many.len(),
                many.iter().map(name_of).collect::<Vec<String>>().join(", ")
            ),
        )),
    }
}

fn name_of(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}
