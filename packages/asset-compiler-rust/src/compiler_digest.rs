//! SHA-256 fingerprints: of bytes, and of a file read once in blocks — the one digest of a content
//! address, and its one lowercase hexadecimal spelling.
use super::*;

/// The lowercase hexadecimal of a digest's bytes: the one spelling of a content address.
pub(super) fn hex_of(digest: impl AsRef<[u8]>) -> String {
    digest.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}
/// The SHA-256 of `b`, its 32 bytes: the one digest of bytes, raw or spelt by `hash`.
pub(super) fn digest_bytes(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}
pub(super) fn hash(b: &[u8]) -> String {
    hex_of(digest_bytes(b))
}
pub(super) fn hash_file(p: &Path) -> Result<String> {
    Ok(hash_file_read(p)?.0)
}
/// File fingerprint and last byte, from a single read pass: a caller wanting to
/// know how file ends does not have to re-open it afterwards. `None` for empty file.
pub(super) fn hash_file_tail(p: &Path) -> Result<(String, Option<u8>)> {
    let (sha256, last, _) = hash_file_read(p)?;
    Ok((sha256, last))
}
/// File fingerprint and size from the same pass: a proof of thousands of objects
/// does not stat each one after reading it.
pub(super) fn hash_file_sized(p: &Path) -> Result<(String, u64)> {
    let (sha256, _, bytes) = hash_file_read(p)?;
    Ok((sha256, bytes))
}
fn hash_file_read(p: &Path) -> Result<(String, Option<u8>, u64)> {
    hash_open(File::open(p)?)
}
/// Fingerprint, last byte and size of an open file: a caller that opened it
/// itself, to read its absence from the open, hashes it from here.
pub(super) fn hash_open(mut f: File) -> Result<(String, Option<u8>, u64)> {
    let mut h = Sha256::new();
    let mut block = [0u8; 65536];
    let mut last = None;
    let mut bytes = 0u64;
    loop {
        let n = f.read(&mut block)?;
        if n == 0 {
            break;
        }
        h.update(&block[..n]);
        last = Some(block[n - 1]);
        bytes += n as u64;
    }
    Ok((hex_of(h.finalize()), last, bytes))
}
