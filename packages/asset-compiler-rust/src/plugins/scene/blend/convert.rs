//! Du fichier Blender à la scène intermédiaire écrite dans le cache.
//!
//! Le parcours est celui du fichier, borné à la scène active : chaque bloc `OB` de type maillage
//! qu'une collection de cette scène porte devient un nœud, chaque bloc `ME` un maillage glTF, versé
//! une seule fois — plusieurs objets qui partagent un même maillage
//! partagent donc le même, et n'en diffèrent que par leur matrice. Un nœud racine porte la
//! conversion d'axes, Blender travaillant en Z vers le haut et le glTF en Y vers le haut : une seule
//! matrice, exacte, plutôt qu'une retouche de chaque sommet.
use super::*;

/// La conversion d'axes, colonne par colonne : x reste x, y devient z, z devient -y.
const Z_UP_TO_Y_UP: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// Lit le fichier et écrit sa conversion dans le cache. Rien n'est écrit à côté de la source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let source = single(request.inputs)?;
    // Le plafond vaut d'abord pour ce qui est lu depuis le disque : un fichier plus gros que lui ne
    // rentre pas davantage une fois déballé, et il n'est pas chargé en mémoire pour le découvrir.
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
        out: Out::new(),
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
    if scene.out.nodes.len() < 2 {
        return Err(CompilerError::new(
            "IMPORT_EMPTY",
            format!("blend: {} carries no mesh object", source.display()),
        ));
    }
    let key = hash(format!("{}:{}\n{digest}", plugin.name(), plugin.version()).as_bytes());
    let directory = request.cache.join("native").join("imports").join(key);
    let files = json!([{"file": name_of(source), "bytes": raw.len(), "sha256": digest}]);
    let counts = scene.out.counts.clone();
    let written = scene
        .out
        .write(plugin, &directory, source, files, started)?;
    (request.progress)(json!({
        "phase":"import-source","step":"complete","plugin":NAME,"counts":counts,
        "ms":started.elapsed().as_secs_f64()*1000.0,
    }));
    Ok(written)
}

/// Le fichier à compiler. Deux `.blend` dans un dossier, c'est une ambiguïté que le pilote ne
/// tranche pas à la place de l'appelant.
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
