//! Les empreintes que le sidecar nomme, lues depuis son en-tête. Sorties de `manifest_binary.rs`
//! pour tenir la limite de lignes du dépôt, sans rien changer à ce qu'elles lisent.
use super::{
    bad, Result, BUNDLE_SHA, GEOMETRY_SHA, HEADER_WORDS, MANIFEST_BINARY_MAGIC,
    MANIFEST_BINARY_VERSION, PAGE_SHA,
};

/// Every object digest a binary sidecar names: the PAGE, GEOMETRY and BUNDLE sha columns, 64 ASCII
/// characters per entry. Reads the header written by `split`; a foreign or truncated file is refused.
pub fn digests(bytes: &[u8]) -> Result<Vec<String>> {
    let word = |at: usize| -> Result<usize> {
        Ok(u32::from_le_bytes(
            bytes
                .get(at..at + 4)
                .ok_or_else(|| bad("Manifest binary is truncated"))?
                .try_into()
                .expect("four bytes"),
        ) as usize)
    };
    if word(0)? != MANIFEST_BINARY_MAGIC as usize {
        return Err(bad("Manifest binary magic mismatch"));
    }
    if word(4)? != MANIFEST_BINARY_VERSION as usize {
        return Err(bad("Manifest binary version mismatch"));
    }
    let columns = word(8)?;
    let mut out = Vec::new();
    for index in [PAGE_SHA, GEOMETRY_SHA, BUNDLE_SHA] {
        if index >= columns {
            continue;
        }
        let at = (HEADER_WORDS + index * 2) * 4;
        let (offset, length) = (word(at)?, word(at + 4)?);
        let column = bytes
            .get(offset..offset + length)
            .ok_or_else(|| bad("Manifest binary column exceeds the file"))?;
        if length % 64 != 0 {
            return Err(bad("Digest column length is not a multiple of 64"));
        }
        // A page without its own geometry leaves a zero-filled slot in the geometry column.
        for entry in column.chunks(64).filter(|e| e[0] != 0) {
            out.push(
                std::str::from_utf8(entry)
                    .map_err(|_| bad("Digest column is not ASCII"))?
                    .to_string(),
            );
        }
    }
    Ok(out)
}
