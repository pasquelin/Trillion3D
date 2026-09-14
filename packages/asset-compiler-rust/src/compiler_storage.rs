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
