//! The manifest as a page tree: `clusters.json` is a root of fixed size — the fields that
//! name the product, the slot of its head page and `FAN_OUT` slots of mesh pages, in the layout of
//! the cell index and read by its pager (`partition/pages.rs`). The head page holds every other field and
//! the previews' sidecar; a mesh page, slim primitives and their sidecar, cut under `PAGE_BYTES`.
//! Files are named by content.
use crate::compiler::tables::partition::pages::*;
use crate::manifest_binary::{Encoded, MANIFEST_BINARY_VERSION};
use crate::texture::TexturePreview;
use crate::*;
use serde_json::Map;
use std::ops::Range;

mod mesh;
pub(crate) use mesh::*;

/// The manifest's pages: a mesh page lists its slim primitives.
pub(crate) const MANIFEST_PAGES: Kind = Kind {
    prefix: "manifest-page-",
    version: MANIFEST_BINARY_VERSION,
    records: "primitives",
};
/// The fields the root keeps: what names the product, whatever the world.
#[rustfmt::skip]
const FIXED: [&str; 5] = ["status", "formatVersion", "scope", "key", "compilerVersion"];

/// The file of the sidecar whose fingerprint is `sha256`.
pub(crate) fn sidecar_file(sha256: &str) -> String {
    format!("{}{sha256}.bin", MANIFEST_PAGES.prefix)
}

/// The page of the `encoded` primitives in `range` under `top` and `previews`, naming its sidecar:
/// written in `directory` when one is given, its fingerprint returned; else only measured, under a
/// fingerprint of zeros.
fn columned(
    top: &Map<String, Value>,
    (encoded, range): (&Encoded, Range<usize>),
    previews: &[TexturePreview],
    directory: Option<&Path>,
) -> Result<(Value, String)> {
    let (mut page, bytes) = encoded.page(top, range, previews, directory.is_some())?;
    let sha256 = seal(&mut page, &bytes, directory)?;
    Ok((page, sha256))
}

/// Names in `page` its sidecar of `bytes`, written in `directory` when one is given, its
/// fingerprint returned; else only measured, under a fingerprint of zeros, of the same width.
fn seal(page: &mut Value, bytes: &[u8], directory: Option<&Path>) -> Result<String> {
    let sha256 = directory.map_or_else(|| "0".repeat(64), |_| hash(bytes));
    if let Some(directory) = directory {
        atomic(&directory.join(sidecar_file(&sha256)), bytes)?;
    }
    page["binary"]["url"] = json!(sidecar_file(&sha256));
    page["binary"]["sha256"] = json!(&sha256);
    Ok(sha256)
}

/// Writes the manifest `result` as pages in `directory` — `extra` among its fields, the texture
/// previews in the head's sidecar, its primitives in `mesh`, already written — then its root, and
/// removes the pages an older root named. The run's report stays out: one scene, one output.
pub(crate) fn write_manifest(
    result: &Value,
    extra: Value,
    previews: &[TexturePreview],
    mesh: &MeshPages,
    directory: &Path,
) -> Result<()> {
    let fields = result.as_object().expect("a manifest").iter();
    let fields = fields.filter(|(field, _)| *field != MANIFEST_PAGES.records);
    let mut top: Map<String, Value> = fields.map(|(k, v)| (k.clone(), v.clone())).collect();
    if let Some(Value::Object(metrics)) = top.get_mut("metrics") {
        metrics.retain(|name, _| !is_run_measure(name));
    }
    if let Value::Object(extra) = extra {
        top.extend(extra);
    }
    let mut root = Map::new();
    for field in FIXED {
        root.extend(top.remove_entry(field));
    }
    // The head lists no primitive: no bundle to name a geometry container.
    let none = Encoded::new(&[], 0)?;
    let (mut head, sha256) = columned(&top, (&none, 0..0), previews, Some(directory))?;
    head["version"] = json!(MANIFEST_PAGES.version);
    let slot = write_page(&MANIFEST_PAGES, directory, &head, &[])?;
    let mut kept = mesh.kept.clone();
    kept.extend([sha256, slot[..64].to_string()]);
    root.insert("head".into(), json!(slot));
    root.insert("pages".into(), json!(mesh.slots));
    atomic(&directory.join(MANIFEST_FILE), &serde_json::to_vec(&root)?)?;
    // A refused folder is rebuilt under its key, which prune keeps whole: its old pages go here.
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        let Some(named) = name.strip_prefix(MANIFEST_PAGES.prefix) else {
            continue;
        };
        if !named.get(..64).is_some_and(|sha256| kept.contains(sha256)) {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

/// A manifest read back through its pages: every field in one value — the root's, the head's and
/// the primitives of every mesh page in order — and the sidecars, the head's first.
pub(crate) struct Paged {
    pub manifest: Value,
    pub sidecars: Vec<Vec<u8>>,
}

/// The sidecar `binary` describes, read from `directory` and proven by its size and fingerprint.
fn read_sidecar(directory: &Path, binary: &Value) -> std::result::Result<Vec<u8>, String> {
    let sha256 = binary["sha256"].as_str().unwrap_or_default();
    let name = sidecar_file(sha256);
    let mismatch = "is not the sidecar its page names";
    read_proven(directory, &name, binary["bytes"].as_u64(), sha256, mismatch)
}

/// The manifest whose root is `root`, in `directory`, each page and sidecar proven by its size and
/// fingerprint.
pub(crate) fn read_manifest(directory: &Path, root: &Value) -> std::result::Result<Paged, String> {
    let kind = &MANIFEST_PAGES;
    let head = read_slot(kind, directory, &root["head"], "the root")?;
    let Some((_, Value::Object(mut manifest))) = head else {
        return Err("the root names no head page".into());
    };
    let mut pages = Vec::new();
    read_leaves(kind, directory, &root["pages"], "the root", &mut pages)?;
    let mut sidecars = vec![read_sidecar(directory, &manifest["binary"])?];
    let mut primitives = Vec::new();
    for mut page in pages {
        sidecars.push(read_sidecar(directory, &page["binary"])?);
        if let Value::Array(slim) = page[kind.records].take() {
            primitives.extend(slim);
        }
    }
    manifest.remove("version");
    for (field, value) in root.as_object().ok_or("the root is no object")? {
        if field != "head" && field != "pages" {
            manifest.insert(field.clone(), value.clone());
        }
    }
    manifest.insert(kind.records.into(), Value::Array(primitives));
    Ok(Paged {
        manifest: Value::Object(manifest),
        sidecars,
    })
}

/// The manifest of the key folder `directory`, read through its root `clusters.json`.
pub(crate) fn read_manifest_at(directory: &Path) -> std::result::Result<Paged, String> {
    let text =
        fs::read(directory.join(MANIFEST_FILE)).map_err(|e| format!("{MANIFEST_FILE}: {e}"))?;
    let root = serde_json::from_slice(&text).map_err(|e| format!("{MANIFEST_FILE}: {e}"))?;
    read_manifest(directory, &root)
}
