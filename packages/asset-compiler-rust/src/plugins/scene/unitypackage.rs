//! `.unitypackage` driver, a container. The package is not a scene: it is a Unity project laid
//! flat, one directory per asset. This driver rebuilds the `Assets/…` tree under the cache, then
//! routes that directory like any other source — it yields what the retained scene driver
//! yields, in practice `unity`. Nothing is re-encoded: each file comes out with its original
//! bytes, and each file's licence remains that of its author.
//!
//! Structure, as the editor documents it: a tar archive gzip-compressed, whose each first-level
//! entry is a directory named by the asset's GUID. That directory carries `pathname` — the
//! target path in the project, on its first line —, `asset` — the file's bytes, absent when the
//! entry describes a project directory —, `asset.meta` — the import metadata — and sometimes
//! `preview.png`, an editor thumbnail left aside: it is not of the project.
//!
//! Provenance: open archive format (POSIX 1003.1-1988 ustar, RFC 1952 for gzip), read by the
//! `tar` 0.4.46 and `flate2` 1.1.10 crates (MIT OR Apache-2.0), decompression only, `flate2` on
//! its pure-Rust backend and `tar` without `xattr`. No editor code, SDK or library enters here,
//! and nothing is decrypted or circumvented.
use super::*;
use crate::{is_safe_source_name, CompilerError};
use flate2::read::GzDecoder;
use std::{
    collections::BTreeMap,
    fs,
    io::{BufReader, Read},
};

pub(super) static UNITYPACKAGE: UnityPackage = UnityPackage;
pub(super) struct UnityPackage;

/// gzip magic number (RFC 1952): every package starts there.
const GZIP_MAGIC: &[u8] = b"\x1f\x8b";
/// Target path of the asset in the project, first line of the file.
const PATHNAME: &str = "pathname";
/// File bytes. Its absence in a GUID directory names a project directory.
const ASSET: &str = "asset";
/// Import metadata, placed beside the asset under the name the editor gives them.
const META: &str = "asset.meta";
/// Read ceiling of a `pathname`: beyond it, the entry does not carry a project path.
const MAX_PATHNAME_BYTES: u64 = 64 * 1024;

impl Plugin for UnityPackage {
    fn name(&self) -> &'static str {
        "unitypackage"
    }
    /// The container reads no geometry: this version names the extractor, not a decoder.
    fn version(&self) -> &'static str {
        "unitypackage-ustar-gzip-tar-0.4.46-flate2-1.1.10-extract-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["unitypackage"]
    }
}

impl ScenePlugin for UnityPackage {
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(GZIP_MAGIC)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        archive::container(request, self, None, |file, root| {
            let stream = GzDecoder::new(BufReader::new(fs::File::open(file)?));
            unpack(request, stream, file, root)
        })
    }
}

/// What a GUID directory announces: the target path, and whether it carries asset bytes.
#[derive(Default)]
struct Target {
    path: String,
    file: bool,
}

/// Where members wait for their GUID's `pathname`, which may come after them. The name holds
/// `..`, which `safe_join` refuses: no target path of the package can land there.
const PENDING: &str = "..pending";

/// One pass over the decompressed `stream`: each member is written as read, to the pending area
/// under its entry number — never under a name the package chose —, then renamed to its target,
/// in archive order, once the gzip footer proved the stream whole. The last member written to a
/// path wins, as when it was written in place. Yields the entry count and the total written. A
/// refusal leaves no file: `root` is the container's staging directory, removed whole. A link
/// entry stops everything.
pub(super) fn unpack<R: Read>(
    request: &SceneRequest<'_>,
    stream: R,
    source: &Path,
    root: &Path,
) -> Result<(usize, u64)> {
    let pending = root.join(PENDING);
    fs::create_dir_all(&pending)?;
    let mut archive = tar::Archive::new(stream);
    let mut targets: BTreeMap<String, Target> = BTreeMap::new();
    // Each written member, in archive order: its GUID, whether it is the `.meta`, its file.
    let mut members: Vec<(String, bool, PathBuf)> = Vec::new();
    let (mut entries, mut declared, mut written) = (0usize, 0u64, 0u64);
    for entry in archive.entries().map_err(unreadable(source))? {
        archive::check(request)?;
        let mut entry = entry.map_err(unreadable(source))?;
        entries += 1;
        archive::under_entry_limit(entries)?;
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            let name = String::from_utf8_lossy(&entry.path_bytes()).into_owned();
            let detail = format!("archive entry {name:?} is a link");
            return Err(CompilerError::new(archive::SYMLINK, detail));
        }
        declared = declared.saturating_add(entry.size());
        archive::under_byte_limit(declared)?;
        let Some((guid, member)) = split(&entry) else {
            continue;
        };
        let meta = match member.as_str() {
            PATHNAME => {
                let path = first_line(&mut entry).map_err(unreadable(source))?;
                // Judged here, by the same rule as any archive entry, before it names a write.
                archive::safe_join(root, &path)?;
                targets.entry(guid).or_default().path = path;
                continue;
            }
            ASSET => false,
            META => true,
            _ => continue,
        };
        if !meta {
            targets.entry(guid.clone()).or_default().file = true;
        }
        let file = pending.join(entries.to_string());
        let mut out = fs::File::create(&file)?;
        let room = archive::LIMITS.bytes - written;
        written += std::io::copy(&mut Read::take(&mut entry, room + 1), &mut out)
            .map_err(unreadable(source))?;
        archive::under_byte_limit(written)?;
        members.push((guid, meta, file));
    }
    ended(archive, source)?;
    // A GUID directory without `pathname` has no place in the project: it is not written.
    targets.retain(|_, target| !target.path.is_empty());
    if targets.is_empty() {
        return Err(archive::empty(source));
    }
    for (guid, meta, file) in &members {
        let Some(target) = targets.get(guid) else {
            continue;
        };
        // The editor's `.meta` sits beside what it describes, project directory included.
        let path = if *meta {
            archive::safe_join(root, &format!("{}.meta", target.path))?
        } else {
            archive::safe_join(root, &target.path)?
        };
        land(file, &path)?;
    }
    for target in targets.values().filter(|target| !target.file) {
        fs::create_dir_all(archive::safe_join(root, &target.path)?)?;
    }
    fs::remove_dir_all(&pending)?;
    Ok((entries, written))
}

/// Moves a written member to its target path: a rename, no byte copied again.
fn land(from: &Path, to: &Path) -> Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(fs::rename(from, to)?)
}

/// Reads what remains of the stream after the last tar entry: the gzip footer, which carries
/// the CRC32 digest of the unpacked bytes and their count (RFC 1952). `tar` stops before it,
/// and without this read a truncated package or one with a lying footer would pass as whole.
fn ended<R: Read>(archive: tar::Archive<R>, source: &Path) -> Result<()> {
    std::io::copy(&mut archive.into_inner(), &mut std::io::sink()).map_err(unreadable(source))?;
    Ok(())
}

/// GUID and member of an entry `<guid>/<member>`. An entry deeper, placed at the package root
/// or named outside safe source names is not the documented structure: left aside.
fn split<R: Read>(entry: &tar::Entry<'_, R>) -> Option<(String, String)> {
    let path = entry.path().ok()?;
    let mut parts = path.components();
    let guid = parts.next()?.as_os_str().to_str()?.to_string();
    let member = parts.next()?.as_os_str().to_str()?.to_string();
    (parts.next().is_none() && is_safe_source_name(&guid)).then_some((guid, member))
}

/// First line of `pathname`: the target path. The second, when the editor writes one, is the
/// old path of a moved asset, which the rebuilt project has no use for.
fn first_line(entry: &mut impl Read) -> std::io::Result<String> {
    let mut text = String::new();
    Read::take(entry, MAX_PATHNAME_BYTES).read_to_string(&mut text)?;
    Ok(text.lines().next().unwrap_or_default().trim().to_string())
}

/// Refusal of an unreadable package: a truncated or corrupt gzip arrives here as an I/O error,
/// and comes out named `ARCHIVE_UNREADABLE` without a byte remaining written.
fn unreadable(source: &Path) -> impl Fn(std::io::Error) -> CompilerError + '_ {
    move |error| archive::unreadable(source, error)
}
