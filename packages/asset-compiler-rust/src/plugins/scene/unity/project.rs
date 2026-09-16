//! L'arbre du projet : le GUID d'un asset vit dans son `.meta` voisin, et c'est par ce GUID que la
//! scène nomme ses modèles, ses matériaux et ses textures. On indexe donc une fois tous les `.meta`
//! sous la racine, puis toute référence se résout par table. Rien n'est écrit à côté de la source.
use super::*;
use std::collections::HashMap;

/// Les dossiers de travail de l'éditeur : ni assets ni données de scène, on ne les parcourt pas.
const SKIPPED: [&str; 6] = ["Library", "Temp", "Logs", "obj", "Build", "UserSettings"];
/// Plafond de lecture d'un fichier de données : au-delà, la source n'est pas du YAML de scène.
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;
/// Profondeur maximale du parcours d'un projet : un projet range ses assets, il ne les enfouit pas,
/// et un arbre de liens ne doit pas faire tourner le compilateur sans fin.
const MAX_SCAN_DEPTH: usize = 16;

/// Parcourt les fichiers du projet, en laissant de côté les dossiers de travail de l'éditeur et les
/// dossiers cachés. `visit` reçoit chaque fichier avec son nom et rend `false` pour arrêter là ;
/// le parcours rend alors `false` à son tour.
fn walk(root: &Path, visit: &mut dyn FnMut(&Path, &str) -> bool) -> bool {
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((directory, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                if depth < MAX_SCAN_DEPTH && !SKIPPED.contains(&name.as_str()) {
                    stack.push((path, depth + 1));
                }
            } else if !visit(&path, &name) {
                return false;
            }
        }
    }
    true
}

/// Les scènes qui vivent sous ce dossier. Non vide, c'est un projet Unity : le dossier entier est la
/// source, et les modèles rangés dessous n'en sont que des entrées.
pub(super) fn scenes_under(directory: &Path) -> Vec<PathBuf> {
    let mut scenes = Vec::new();
    walk(directory, &mut |path, _| {
        if path.extension().is_some_and(|kind| kind == "unity") {
            scenes.push(path.to_path_buf());
        }
        true
    });
    scenes
}

pub(super) struct Project {
    /// Le dossier des URI de ressource : les images sont nommées relativement à lui.
    pub(super) source_dir: PathBuf,
    by_guid: HashMap<String, PathBuf>,
    pub(super) meta_files: usize,
}

impl Project {
    /// Indexe les `.meta` sous `root`. Le dossier d'un projet Unity peut être profond : le parcours
    /// est borné aux dossiers d'assets, et l'annulation est vérifiée à chaque fichier.
    pub(super) fn index(root: &Path, source_dir: &Path, cancelled: &AtomicBool) -> Result<Project> {
        let mut project = Project {
            source_dir: source_dir.to_path_buf(),
            by_guid: HashMap::new(),
            meta_files: 0,
        };
        let complete = walk(root, &mut |path, name| {
            if cancelled.load(Ordering::Relaxed) {
                return false;
            }
            if name.ends_with(".meta") {
                project.meta_files += 1;
                project.add_meta(path);
            }
            true
        });
        if !complete {
            return Err(CompilerError::new("CANCELLED", "Import cancelled"));
        }
        Ok(project)
    }

    /// Le GUID déclaré par un `.meta`, associé au fichier qu'il décrit.
    fn add_meta(&mut self, meta: &Path) {
        let Some(text) = read_text(meta) else { return };
        let Some(guid) = text.lines().find_map(|line| line.strip_prefix("guid: ")) else {
            return;
        };
        // `Texture.tga.meta` décrit `Texture.tga` : le `.meta` n'ajoute qu'une extension.
        let asset = meta.with_extension("");
        if asset.exists() {
            self.by_guid.insert(guid.trim().to_string(), asset);
        }
    }

    /// Le fichier que ce GUID désigne.
    pub(super) fn asset(&self, guid: &str) -> Option<&Path> {
        self.by_guid.get(guid).map(PathBuf::as_path)
    }

    /// L'URI d'un asset relativement au dossier servi, échappée comme toute référence relative
    /// d'URI : `%`, `#`, l'espace et tout ce qui n'est pas un caractère non réservé s'y écrivent en
    /// `%XX`, sinon le moteur demanderait un autre fichier, ou rien. `None` quand l'asset est hors
    /// de ce dossier : le moteur ne pourrait pas le demander.
    pub(super) fn relative_uri(&self, asset: &Path) -> Option<String> {
        let relative = normalise(asset)
            .strip_prefix(normalise(&self.source_dir))
            .map(Path::to_path_buf)
            .ok()?;
        Some(crate::uri::encode_relative(&relative))
    }
}

/// Le `.meta` qui décrit cet asset : Unity le pose à côté, sous le même nom suivi de `.meta`.
pub(super) fn meta_of(asset: &Path) -> PathBuf {
    let mut name = asset.as_os_str().to_os_string();
    name.push(".meta");
    PathBuf::from(name)
}

/// Le texte d'un fichier de données, sous le plafond de lecture. Ce qui n'est pas de l'UTF-8 lisible
/// rend `None` : le pilote le compte, il ne s'y arrête pas.
pub(super) fn read_text(path: &Path) -> Option<String> {
    let length = fs::metadata(path).ok()?.len();
    if length > MAX_TEXT_BYTES {
        return None;
    }
    fs::read(path)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

/// La racine du projet pour l'index des GUID : le dossier `Assets` qui porte la scène quand il y en
/// a un — c'est là que vivent tous les `.meta` — sinon le dossier de la scène elle-même.
pub(super) fn assets_root(scene: &Path) -> PathBuf {
    let mut found = None;
    for ancestor in scene.ancestors().skip(1) {
        if ancestor.file_name().is_some_and(|name| name == "Assets") {
            found = Some(ancestor.to_path_buf());
        }
    }
    found.unwrap_or_else(|| {
        scene
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
    })
}
