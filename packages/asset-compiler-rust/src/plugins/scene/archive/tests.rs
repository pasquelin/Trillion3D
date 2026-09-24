//! What containers refuse, and what they leave behind when they refuse.
//!
//! Trap archives are built here, byte by byte: an archive that puts a reader to the test must
//! not come from that reader. Nothing is written outside the case's throwaway directory.
use super::*;
use std::fs;

mod package;
mod usdz;
mod zip;

/// A throwaway directory, named by the case that uses it.
fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "trillion3d-conteneur-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("test directory");
    dir
}

/// What a container did with the bytes it was given.
struct Outcome {
    /// The throwaway directory: the source and the cache live there.
    dir: PathBuf,
    /// The refusal code, or `accepted` when the container produced a scene.
    code: String,
    /// What the container published along the way, including the driver chain.
    reports: Vec<Value>,
}

/// Has this container read these bytes, in a throwaway directory of its own.
fn outcome(tag: &str, plugin: &dyn ScenePlugin, name: &str, bytes: &[u8]) -> Outcome {
    let dir = scratch(tag);
    let source = dir.join(name);
    fs::write(&source, bytes).expect("test archive");
    let cache = dir.join("cache");
    let inputs = [source.clone()];
    let cancelled = std::sync::atomic::AtomicBool::new(false);
    let reports = std::sync::Mutex::new(Vec::new());
    let code = match plugin.prepare(&SceneRequest {
        source: &source,
        inputs: &inputs,
        cache: &cache,
        cancelled: &cancelled,
        progress: &|report| reports.lock().expect("reports").push(report),
    }) {
        Ok(_) => "accepted".to_string(),
        Err(error) => error.code.to_string(),
    };
    Outcome {
        dir,
        code,
        reports: reports.into_inner().expect("reports"),
    }
}

/// The extracted directory a container leaves visible under this cache, if there is one. A
/// refused extraction leaves none: the router must never see a work in progress as a scene.
fn extracted(dir: &Path) -> Vec<PathBuf> {
    let archives = dir.join("cache").join("native").join("archives");
    let Ok(entries) = fs::read_dir(&archives) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path().join("content"))
        .filter(|content| content.exists())
        .collect()
}

/// The regular files left anywhere under `dir`.
fn files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for path in entries.flatten().map(|entry| entry.path()) {
        if path.is_dir() {
            out.extend(files(&path));
        } else {
            out.push(path);
        }
    }
    out
}

/// The package or archive once the case is done.
fn cleanup(dir: PathBuf) {
    fs::remove_dir_all(&dir).expect("cleanup");
}

/// An entry of a ZIP archive written here.
struct Entry<'a> {
    name: &'a str,
    /// The bytes as they enter the archive.
    data: &'a [u8],
    /// The declared method: zero stored, eight `deflate`.
    method: u16,
    /// The announced decompressed size, which is that of the bytes only for a stored entry.
    size: u32,
}

impl<'a> Entry<'a> {
    /// An entry stored as-is, the only one the USDZ layout admits.
    fn stored(name: &'a str, data: &'a [u8]) -> Entry<'a> {
        Entry {
            name,
            data,
            method: 0,
            size: data.len() as u32,
        }
    }
}

/// A ZIP archive written byte by byte, from the APPNOTE: local header, payload, central directory,
/// end of directory. `aligned` pads each entry's "extra" field so its payload starts on a multiple
/// of sixty-four bytes, as the USDZ layout requires.
fn zip_bytes(entries: &[Entry<'_>], aligned: bool) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for entry in entries {
        let offset = out.len() as u32;
        let mut crc = flate2::Crc::new();
        crc.update(entry.data);
        let padding = padding(out.len() + 30 + entry.name.len(), aligned);
        let sizes = [crc.sum(), entry.data.len() as u32, entry.size];
        out.extend_from_slice(b"PK\x03\x04");
        put(&mut out, &[20, 0, entry.method, 0, 0]);
        out.extend(sizes.iter().flat_map(|value| value.to_le_bytes()));
        put(&mut out, &[entry.name.len() as u16, padding.len() as u16]);
        out.extend_from_slice(entry.name.as_bytes());
        out.extend_from_slice(&padding);
        out.extend_from_slice(entry.data);
        central.extend_from_slice(b"PK\x01\x02");
        put(&mut central, &[20, 20, 0, entry.method, 0, 0]);
        central.extend(sizes.iter().flat_map(|value| value.to_le_bytes()));
        put(&mut central, &[entry.name.len() as u16, 0, 0, 0, 0]);
        central.extend_from_slice(&0u32.to_le_bytes());
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(entry.name.as_bytes());
    }
    let offset = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(b"PK\x05\x06");
    let count = entries.len() as u16;
    put(&mut out, &[0, 0, count, count]);
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&offset.to_le_bytes());
    put(&mut out, &[0]);
    out
}

/// The "extra" field that aligns a payload starting at this rank. It carries its own four-byte
/// header, so a pad shorter than that rolls over to the next alignment.
fn padding(head: usize, aligned: bool) -> Vec<u8> {
    let mut length = match aligned {
        true => (64 - head % 64) % 64,
        false => 0,
    };
    if length == 0 {
        return Vec::new();
    }
    if length < 4 {
        length += 64;
    }
    let mut out = Vec::new();
    put(&mut out, &[0x1986, length as u16 - 4]);
    out.resize(length, 0);
    out
}

/// Sixteen-bit integers in sequence, as the format writes them.
fn put(out: &mut Vec<u8>, values: &[u16]) {
    out.extend(values.iter().flat_map(|value| value.to_le_bytes()));
}
