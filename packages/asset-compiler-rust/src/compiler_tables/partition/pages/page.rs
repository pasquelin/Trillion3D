//! One page on disk: its bytes measured without laying them, then written under its digest and
//! returned as its slot.
use super::*;

/// The bytes `value` serializes to, counted as they are written, never laid in memory.
pub(crate) fn json_len(value: &Value) -> Result<usize> {
    struct Count(usize);
    impl std::io::Write for Count {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut count = Count(0);
    serde_json::to_writer(&mut count, value)?;
    Ok(count.0)
}

/// Writes `body` as a page of `kind` in `directory`, boxed by the union of `boxes`; its slot.
pub(crate) fn write_page(
    kind: &Kind,
    directory: &Path,
    body: &Value,
    boxes: &[Box6],
) -> Result<String> {
    let bytes = serde_json::to_vec(body)?;
    let sha256 = hash(&bytes);
    atomic(
        &directory.join(format!("{}{sha256}.json", kind.prefix)),
        &bytes,
    )?;
    let mut bounds = EMPTY_FLAT;
    for record in boxes {
        grow_flat(&mut bounds, record);
    }
    let mut slot = format!("{sha256}{:08x}", bytes.len());
    for value in bounds {
        write!(slot, "{:016x}", value.to_bits()).expect("a string takes any write");
    }
    Ok(slot)
}
