//! L'arbre du projet : le GUID d'un asset vit dans son `.meta` voisin, et c'est par ce GUID que la
//! scène nomme ses modèles, ses matériaux et ses textures. On indexe donc une fois tous les `.meta`
//! sous la racine, puis toute référence se résout par table. Rien n'est écrit à côté de la source.
use super::*;
use std::collections::HashMap;

/// Les dossiers de travail de l'éditeur : ni assets ni données de scène, on ne les parcourt pas.
const SKIPPED: [&str; 6] = ["Library", "Temp", "Logs", "obj", "Build", "UserSettings"];
/// Plafond de lecture d'un fichier de données : au-delà, la source n'est pas du YAML de scène.
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

pub(super) struct Project {
    /// Le dossier des URI de ressource : les images sont nommées relativement à lui.
    pub(super) source_dir: PathBuf,
    by_guid: HashMap<String, PathBuf>,
    pub(super) meta_files: usize,
}

impl Project {
    /// Indexe les `.meta` sous `root`. Le dossier d'un projet Unity peut être profond : on borne le
    /// parcours aux dossiers d'assets, et on vérifie l'annulation à chaque dossier.
    pub(super) fn index(root: &Path, source_dir: &Path, cancelled: &AtomicBool) -> Result<Project> {
        let mut project = Project {
            source_dir: source_dir.to_path_buf(),
            by_guid: HashMap::new(),
            meta_files: 0,
        };
        let mut stack = vec![root.to_path_buf()];
        while let Some(directory) = stack.pop() {
            if cancelled.load(Ordering::Relaxed) {
                return Err(CompilerError::new("CANCELLED", "Import cancelled"));
            }
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let path = entry.path();
                if path.is_dir() {
                    if !name.starts_with('.') && !SKIPPED.contains(&name.as_str()) {
                        stack.push(path);
                    }
                } else if name.ends_with(".meta") {
                    project.meta_files += 1;
                    project.add_meta(&path);
                }
            }
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

    /// Le chemin d'un asset relativement au dossier servi, tel qu'il entre dans un `uri` de glTF.
    /// `None` quand l'asset est hors de ce dossier : le moteur ne pourrait pas le demander.
    pub(super) fn relative_uri(&self, asset: &Path) -> Option<String> {
        let relative = normalise(asset)
            .strip_prefix(normalise(&self.source_dir))
            .map(Path::to_path_buf)
            .ok()?;
        Some(
            relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/"),
        )
    }
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
