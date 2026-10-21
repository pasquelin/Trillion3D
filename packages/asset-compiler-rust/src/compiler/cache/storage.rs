use crate::*;

/// Writes `data` at `path` atomically (`atomic_with`).
pub(crate) fn atomic(path: &Path, data: &[u8]) -> Result<()> {
    atomic_with(path, |file| Ok(file.write_all(data)?))
}

/// Writes `path` from what `write` streams into it, atomically: into a file beside it, unique to
/// the process and the thread, renamed over it once whole and flushed, so no reader ever sees a
/// part of it. The one atomic write of the cache, a product streamed in pieces included.
pub(crate) fn atomic_with<T>(
    path: &Path,
    write: impl FnOnce(&mut BufWriter<File>) -> Result<T>,
) -> Result<T> {
    let temp = path.with_extension(format!(
        "tmp-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let mut file = BufWriter::new(File::create(&temp)?);
    let written = write(&mut file)?;
    file.into_inner().map_err(|error| error.into_error())?;
    fs::rename(temp, path)?;
    Ok(written)
}

/// A product of the key folder as the manifest records it (`publish.rs`):
/// its name, and the fingerprint and size of the bytes its writer had in hand —
/// nothing is read back from disk to record it.
pub(crate) struct Product {
    pub name: String,
    pub sha256: String,
    pub bytes: u64,
}

/// Writes `name` under `directory` atomically and records it.
pub(crate) fn product(directory: &Path, name: &str, data: &[u8]) -> Result<Product> {
    product_of(directory, name, data, &hash(data))
}

/// `product`, for bytes whose fingerprint `sha256` their writer already holds: not hashed twice.
pub(crate) fn product_of(
    directory: &Path,
    name: &str,
    data: &[u8],
    sha256: &str,
) -> Result<Product> {
    atomic(&directory.join(name), data)?;
    Ok(Product {
        name: name.to_string(),
        sha256: sha256.to_string(),
        bytes: data.len() as u64,
    })
}

/// A writer that fingerprints what passes through it, for a product streamed to
/// disk in pieces (`copy_source_bin`): hashed once, as it is written.
pub(crate) struct Hashing<W: Write> {
    inner: W,
    hasher: Sha256,
    bytes: u64,
}
impl<W: Write> Hashing<W> {
    pub fn new(inner: W) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            bytes: 0,
        }
    }
    /// The record of what was written, once the writer is flushed.
    pub fn product(self, name: &str) -> Product {
        Product {
            name: name.to_string(),
            sha256: crate::hex_of(self.hasher.finalize()),
            bytes: self.bytes,
        }
    }
}
impl<W: Write> Write for Hashing<W> {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        let written = self.inner.write(data)?;
        self.hasher.update(&data[..written]);
        self.bytes += written as u64;
        Ok(written)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

/// The compiler's folder in the cache at `cache`: the scopes, the objects, the imports, the baked
/// texture levels, the lock. Every folder under it is named by one of the functions below.
pub(crate) fn native_dir(cache: &Path) -> PathBuf {
    cache.join("native")
}

/// The folder of the shared objects, content-addressed, that the manifests of every scope name.
pub(crate) fn objects_dir(cache: &Path) -> PathBuf {
    native_dir(cache).join("objects")
}

/// The folder of the scenes the format drivers convert, one per import key (`import_source`).
pub(crate) fn imports_dir(cache: &Path) -> PathBuf {
    native_dir(cache).join("imports")
}

/// The folder of the conversions' audit records, beside the scenes and never among them
/// (`../../plugins/scene/convert/external/probe.rs`).
pub(crate) fn probes_dir(cache: &Path) -> PathBuf {
    native_dir(cache).join("imports-externes")
}

/// The folder of the archives the container drivers extract, one per extraction key
/// (`../../plugins/scene/archive.rs`).
pub(crate) fn archives_dir(cache: &Path) -> PathBuf {
    native_dir(cache).join("archives")
}

/// The folder of a compile's page runs until the containers take them: beside the objects, never
/// one (`../primitive/pages.rs`).
pub(crate) fn runs_dir(cache: &Path) -> PathBuf {
    native_dir(cache).join("runs")
}

/// The URL of the shared object whose fingerprint is `sha256`, relative to the manifest: the one
/// spelling of every geometry container and physics shape a manifest cites.
pub(crate) fn object_url(sha256: &str) -> String {
    format!("../../objects/{sha256}.bin")
}

/// Where the object named `digest` lives: one spelling for every writer and the proof. The name is
/// the SHA-256 of the content with the `.bin` extension, which a static server serves as
/// `application/octet-stream` with no configuration; the manifest names each object in full.
pub(crate) fn object_path(o: &Options, digest: &str) -> PathBuf {
    objects_dir(&o.cache).join(format!("{digest}.bin"))
}

/// Whether the object at `path` is present at `bytes` long. Its name is the fingerprint of its
/// content, and a write a crash cut short is shorter: the length says it is whole without hashing
/// it again, and a warm compile never reads back a 64 MiB container to store it. The reuse proof
/// alone hashes every object it keeps (`reuse_proof.rs`).
fn object_intact(path: &Path, bytes: usize) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.len() == bytes as u64)
}

/// Stores `bytes` as the object of their digest unless an intact copy already holds it: the
/// digest, and whether that copy was there. The one store-if-missing of every object writer.
fn store_digest(o: &Options, bytes: &[u8]) -> Result<(String, bool)> {
    let digest = hash(bytes);
    let target = object_path(o, &digest);
    let found = object_intact(&target, bytes.len());
    if !found {
        store_object(&target, bytes)?;
    }
    Ok((digest, found))
}

/// Stores `bytes` as an object (`store_digest`): the descriptor a manifest names it by,
/// `{url, sha256, bytes}`, and whether an intact copy was already there. Every object a manifest
/// names is one of these, known by its `url` (`prune.rs`, `referenced_objects`).
pub(crate) fn store_descriptor(o: &Options, bytes: &[u8]) -> Result<(Value, bool)> {
    let (digest, found) = store_digest(o, bytes)?;
    let descriptor = json!({"url":object_url(&digest),"sha256":digest,"bytes":bytes.len()});
    Ok((descriptor, found))
}

/// Content-addressed object store write.
///
/// The file name is the SHA-256 of its bytes, so a name always holds the same content. Creating the
/// file exclusively never truncates an object another process already finished, and the manifest
/// root `clusters.json` is published atomically once every object is on disk, so no reader can
/// learn of an object before it is complete. Dropping the temp-file rename halves the directory
/// work of a cache of many small objects — physics shapes. The objects' folder is
/// made by the first object stored in it, the one writer that needs it.
fn store_object(path: &Path, data: &[u8]) -> Result<()> {
    let create = || {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
    };
    let created = match create() {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path.parent().expect("an object lies in a folder"))?;
            create()
        }
        opened => opened,
    };
    match created {
        Ok(mut file) => {
            file.write_all(data)?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => atomic(path, data),
        Err(error) => Err(error.into()),
    }
}
