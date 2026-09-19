//! Project tree: an asset's GUID lives in its neighbouring `.meta`, and it is by that GUID that
//! the scene names its models, materials and textures. Every `.meta` under the root is therefore
//! indexed once, then every reference resolves by table. Nothing is written beside the source.
use super::*;
use std::collections::HashMap;

/// Editor working directories: neither assets nor scene data, they are not walked.
const SKIPPED: [&str; 6] = ["Library", "Temp", "Logs", "obj", "Build", "UserSettings"];
/// Read ceiling of a data file: beyond it, the source is not scene YAML.
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;
/// Maximum depth of a project walk: a project stores its assets, it does not bury them, and a
/// tree of links must not make the compiler spin forever.
const MAX_SCAN_DEPTH: usize = 16;

/// Walks the project's files, leaving aside the editor's working directories and hidden
/// directories. `visit` receives each file with its name and yields `false` to stop there; the
/// walk then yields `false` in turn.
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

/// Scenes that live under this directory. Non-empty, it is a Unity project: the whole directory
/// is the source, and models stored under it are only its inputs.
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
    /// Resource URI directory: images are named relative to it.
    pub(super) source_dir: PathBuf,
    by_guid: HashMap<String, PathBuf>,
    pub(super) meta_files: usize,
}

impl Project {
    /// Indexes `.meta` files under `root`. A Unity project's directory can be deep: the walk is
    /// bounded to asset directories, and cancellation is checked at each file.
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

    /// GUID a `.meta` declares, associated with the file it describes.
    fn add_meta(&mut self, meta: &Path) {
        let Some(text) = read_text(meta) else { return };
        let Some(guid) = text.lines().find_map(|line| line.strip_prefix("guid: ")) else {
            return;
        };
        // `Texture.tga.meta` describes `Texture.tga`: `.meta` only adds one extension.
        let asset = meta.with_extension("");
        if asset.exists() {
            self.by_guid.insert(guid.trim().to_string(), asset);
        }
    }

    /// File this GUID names.
    pub(super) fn asset(&self, guid: &str) -> Option<&Path> {
        self.by_guid.get(guid).map(PathBuf::as_path)
    }

    /// URI of an asset relative to the served directory, escaped as any relative URI reference:
    /// `%`, `#`, space and anything that is not an unreserved character are written there as
    /// `%XX`, otherwise the engine would request another file, or none. `None` when the asset
    /// is outside this directory: the engine could not request it.
    pub(super) fn relative_uri(&self, asset: &Path) -> Option<String> {
        let relative = normalise(asset)
            .strip_prefix(normalise(&self.source_dir))
            .map(Path::to_path_buf)
            .ok()?;
        Some(crate::uri::encode_relative(&relative))
    }
}

/// `.meta` that describes this asset: Unity places it beside, under the same name followed by
/// `.meta`.
pub(super) fn meta_of(asset: &Path) -> PathBuf {
    let mut name = asset.as_os_str().to_os_string();
    name.push(".meta");
    PathBuf::from(name)
}

/// Text of a data file, under the read ceiling. What is not readable UTF-8 yields `None`: the
/// driver counts it, it does not stop there.
pub(super) fn read_text(path: &Path) -> Option<String> {
    let length = fs::metadata(path).ok()?.len();
    if length > MAX_TEXT_BYTES {
        return None;
    }
    fs::read(path)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

/// Project root for the GUID index: the `Assets` folder that carries the scene when there is
/// one — that is where every `.meta` lives — otherwise the scene's own directory.
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
