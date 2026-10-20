//! From the Blender file to the intermediate scene written in the cache.
//!
//! The walk is that of the file, bounded to the active scene: each mesh-type `OB` block a
//! collection of that scene holds becomes a node, each `ME` block a glTF mesh, poured once —
//! several objects that share a mesh therefore share the same one, and differ only by their
//! matrix. A root node carries the axis conversion, Blender working Z-up and glTF Y-up: one
//! exact matrix, rather than retouching every vertex.
use super::*;
use crate::import::SceneTables;

/// Reads the file and writes its conversion into the cache. Nothing is written next to the source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let source = single_input(request.inputs, NAME, ".blend")?;
    // The file is mapped, never copied: its pages stay the system's to evict. The job's RAM budget
    // bounds what is decoded from it — the unpacked bytes of a wrapped file, then the scene binary.
    let raw = crate::map_source(source)?;
    let digest = hash(&raw);
    let file = BlendFile::open(&raw, request.ram_budget)?;
    (request.progress)(json!({
        "phase":"import-source","step":"scan","plugin":NAME,
        "blendVersion":file.version,"blocks":file.blocks.len(),
    }));
    let root = image_root(request.source);
    let mut scene = walker::Scene {
        out: Out {
            scene: SceneTables::new(plugin),
            room: request.ram_budget.saturating_sub(file.held()),
        },
        images: Images::default(),
        materials: HashMap::new(),
        meshes: HashMap::new(),
        root: &root,
        cancelled: request.cancelled,
    };
    scene.out.scene.nodes.push(json!({
        "name": name_of(source), "matrix": crate::plugins::scene::axes::root(1.0, true), "children": [],
    }));
    let scenes = file.of(*b"SC\0\0").count();
    if scenes > 1 {
        scene.out.scene.count("scenes", scenes);
        scene
            .out
            .scene
            .report
            .add_count("blend-extra-scenes", scenes - 1);
    }
    let active = active::objects(&file);
    let mut outside = 0;
    for block in file.of(*b"OB\0\0") {
        cancel::check(request.cancelled)?;
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
        .scene
        .report
        .add_count("blend-object-outside-scene", outside);
    // The key holds the digest of the file read: an unchanged file is rewritten identically, at
    // the same place.
    scene.out.scene.read_source(source, raw.len(), &digest);
    super::finish(
        scene.out.scene,
        request,
        plugin,
        source,
        started,
        &format!("blend: {} carries no mesh object", source.display()),
    )
}

fn name_of(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}
