use super::*;

pub(super) fn atomic(path: &Path, data: &[u8]) -> Result<()> {
    let temp = path.with_extension(format!(
        "tmp-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    fs::write(&temp, data)?;
    fs::rename(temp, path)?;
    Ok(())
}

/// A product of the key folder as the manifest records it (`compiler_publish.rs`):
/// its name, and the fingerprint and size of the bytes its writer had in hand —
/// nothing is read back from disk to record it.
pub(super) struct Product {
    pub name: String,
    pub sha256: String,
    pub bytes: u64,
}

/// Writes `name` under `directory` atomically and records it.
pub(super) fn product(directory: &Path, name: &str, data: &[u8]) -> Result<Product> {
    atomic(&directory.join(name), data)?;
    Ok(Product {
        name: name.to_string(),
        sha256: hash(data),
        bytes: data.len() as u64,
    })
}

/// A writer that fingerprints what passes through it, for a product streamed to
/// disk in pieces (`copy_source_bin`): hashed once, as it is written.
pub(super) struct Hashing<W: Write> {
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
            sha256: format!("{:x}", self.hasher.finalize()),
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

/// Where the object named `digest` lives: one spelling for every writer and the proof.
pub(super) fn object_path(o: &Options, digest: &str) -> PathBuf {
    o.cache
        .join("native")
        .join("objects")
        .join(format!("{digest}.bin"))
}

/// Size of the object at `path` when it is present and its bytes hash to
/// `digest`; `None` when it is absent or does not match, so the caller writes it.
/// The file is opened once: its absence is read from the open, not from a probe
/// before it.
pub(super) fn object_intact(path: &Path, digest: &str) -> Result<Option<u64>> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let (sha256, _, bytes) = hash_open(file)?;
    Ok((sha256 == digest).then_some(bytes))
}

/// Content-addressed object store write.
///
/// The file name is the SHA-256 of its bytes, so a name always holds the same content. Creating the
/// file exclusively never truncates an object another process already finished, and `clusters.json`
/// — the only file that names an object — is published atomically once every object is on disk, so
/// no reader can learn of an object before it is complete. Dropping the temp-file rename halves the
/// directory work, which dominates a cache made of tens of thousands of small objects.
pub(super) fn store_object(path: &Path, data: &[u8]) -> Result<()> {
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut file) => {
            file.write_all(data)?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => atomic(path, data),
        Err(error) => Err(error.into()),
    }
}
