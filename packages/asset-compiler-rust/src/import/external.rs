//! Files the reader opens **besides** the scene file: an OBJ material library, a
//! geometry cache. Without them, the cache key covered only the claimed file, and
//! a modified `.mtl` left the previous scene in service.
//!
//! They therefore enter the key, absence included: a file that appears changes it
//! as much as a file whose content changes. A previous conversion's record serves
//! as a preview — it gives the key without rereading the source — and when it is
//! wrong the conversion that follows writes the true key.
//!
//! Linked textures enter too, without being opened. Import does not read their
//! bytes: it notes which candidate exists to write a URI, and that finding — the
//! path tried, its presence, its fingerprint when it is there — decides the
//! intermediate glTF. Left out of the key, an image added next to an unchanged
//! source left the previous scene in service.
use super::*;
use std::{fs::File, sync::Mutex};

/// A material library cited by the source — an OBJ's `.mtl`.
pub(super) const MATERIAL_LIBRARY: &str = "material-library";
/// A geometry cache, which the source cites for mesh deformation.
const GEOMETRY_CACHE: &str = "geometry-cache";
/// The scene file itself, the one the reader opens first.
const MAIN_MODEL: &str = "model";
/// Kinds of external file a reader may request, in ufbx contract order.
const KINDS: [&str; 3] = [MATERIAL_LIBRARY, GEOMETRY_CACHE, MAIN_MODEL];
/// An image path tried during texture resolution. Never opened by the reader: its
/// state alone — present or not, and then its fingerprint — decides the URI the
/// scene will carry.
pub(super) const TEXTURE_CANDIDATE: &str = "texture-candidate";

/// A file opened during import, and the fingerprint of what it contained.
pub(super) struct External {
    /// Full path, as the reader asked for it: it is what is rehashed on the next
    /// pass. It never leaves the cache — it names the compiling machine, not the scene.
    path: String,
    /// The name alone, the one that enters the key and the manifest.
    name: String,
    kind: &'static str,
    /// `None` when opening failed.
    digest: Option<String>,
    /// A text library whose last line is not terminated: the file is cut mid
    /// declaration, and the reader keeps an incomplete value without complaining.
    truncated: bool,
}

fn kind_of(type_: ufbx::OpenFileType) -> &'static str {
    match type_ {
        ufbx::OpenFileType::ObjMtl => MATERIAL_LIBRARY,
        ufbx::OpenFileType::GeometryCache => GEOMETRY_CACHE,
        ufbx::OpenFileType::MainModel => MAIN_MODEL,
    }
}

fn kind_named(name: &str) -> Option<&'static str> {
    KINDS
        .into_iter()
        .chain([TEXTURE_CANDIDATE])
        .find(|kind| *kind == name)
}

/// What we know of an external file now: its fingerprint, or its absence. The
/// hashing pass also returns the last byte of the file: a text library that does
/// not end with a newline has been cut, and the file is not reopened to notice it.
fn describe(path: &Path, kind: &'static str) -> External {
    let read = crate::hash_file_tail(path).ok();
    let truncated = kind == MATERIAL_LIBRARY
        && read
            .as_ref()
            .and_then(|(_, last)| *last)
            .is_some_and(|last| last != b'\n' && last != b'\r');
    let digest = read.map(|(digest, _)| digest);
    External {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string(),
        kind,
        digest,
        truncated,
    }
}

/// Record of an import's openings. The reader calls its callback from its read
/// thread: the lock only makes the record shareable, it is never contended.
#[derive(Default)]
pub(super) struct Externals(Mutex<Vec<External>>);

impl Externals {
    /// The reader's open callback: it notes the file and its fingerprint, then
    /// returns the stream. Nothing is held in memory — the reader reads the file itself.
    pub(super) fn open(&self, path: &str, info: &ufbx::OpenFileInfo) -> Option<ufbx::Stream> {
        let path = Path::new(path);
        let mut entry = describe(path, kind_of(info.type_));
        let opened = entry.digest.as_ref().and_then(|_| File::open(path).ok());
        if opened.is_none() {
            entry.digest = None;
            entry.truncated = false;
        }
        self.0.lock().expect("external files").push(entry);
        opened.map(ufbx::Stream::File)
    }
    /// Notes an image path tried and what was found there. Nothing is opened for
    /// the reader: it is the resolution decision, not consumed bytes, that thus
    /// enters the key.
    pub(super) fn note_texture(&self, path: &Path) {
        let entry = describe(path, TEXTURE_CANDIDATE);
        self.0.lock().expect("external files").push(entry);
    }
    /// Number of files already opened: a bound so only one scene file is reported.
    pub(super) fn opened(&self) -> usize {
        self.0.lock().expect("external files").len()
    }
    /// What a material library did not yield, counted by name. `declared` says the
    /// source did cite a library: the reader also looks for a `.mtl` of its own
    /// accord, and a file it invents is missing to no one when it does not exist.
    pub(super) fn report_since(&self, from: usize, declared: bool, report: &mut Report) {
        let files = self.0.lock().expect("external files");
        let libraries: Vec<&External> = files[from.min(files.len())..]
            .iter()
            .filter(|file| file.kind == MATERIAL_LIBRARY)
            .collect();
        if declared && !libraries.is_empty() && !libraries.iter().any(|f| f.digest.is_some()) {
            report.add("material-library-missing");
        }
        let truncated = libraries.iter().filter(|file| file.truncated).count();
        report.add_count("material-library-truncated", truncated);
    }
    /// Takes the record to make the key and the manifest from it.
    pub(super) fn drain(&self) -> Vec<External> {
        std::mem::take(&mut *self.0.lock().expect("external files"))
    }
}

/// Cache key: the base — driver, version, claimed inputs — then each external
/// file, name and fingerprint. A `.mtl` modified, gone or appeared gives another
/// key, therefore another scene.
pub(super) fn key(base: &str, files: &[External]) -> String {
    let mut material = base.to_string();
    for file in files {
        material.push('\n');
        material.push_str(file.kind);
        material.push(':');
        material.push_str(&file.name);
        material.push(':');
        material.push_str(file.digest.as_deref().unwrap_or("-"));
    }
    hash(material.as_bytes())
}

/// What the manifest publishes of each **opened** file: never its full path.
/// Tried image paths stay in the key alone — they count in tens and are the
/// source of nothing: what resolution kept is read in the glTF `images`.
pub(super) fn manifest(files: &[External]) -> Value {
    Value::Array(
        files
            .iter()
            .filter(|file| file.kind != TEXTURE_CANDIDATE)
            .map(|file| {
                json!({"file":file.name,"kind":file.kind,"sha256":file.digest,"truncated":file.truncated})
            })
            .collect(),
    )
}

mod probe;
pub(super) use probe::{expected, write_probe};
