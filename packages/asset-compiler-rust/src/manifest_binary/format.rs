#[cfg(test)]
pub(crate) mod tests;
use super::*;
use crate::compiler::validate::Fields;

/// The readers of a manifest, each refusal an invalid manifest.
pub(super) const MANIFEST: Fields = Fields("INVALID_MANIFEST");

#[derive(Default)]
pub(crate) struct Column {
    pub(crate) bytes: Vec<u8>,
}
impl Column {
    /// A column whose final size is known is never reallocated during write.
    pub(crate) fn reserve(&mut self, bytes: usize) {
        self.bytes.reserve(bytes);
    }
    pub(crate) fn f64(&mut self, value: f64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    pub(super) fn i32(&mut self, value: i32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    pub(crate) fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    /// A digest is stored as its 64 ASCII hexadecimal characters: one decode for the whole column,
    /// then one slice per entry, costs the reader far less than re-encoding 32 raw bytes each time.
    pub(super) fn sha(&mut self, value: &str) -> Result<()> {
        if !is_digest(value) {
            return Err(MANIFEST.bad(format!(
                "Object digest is not 64 lowercase hexadecimal characters: {value}"
            )));
        }
        self.bytes.extend_from_slice(value.as_bytes());
        Ok(())
    }
    /// Bytes already in column format, copied as is.
    pub(crate) fn raw(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }
    pub(super) fn zeros(&mut self, count: usize) {
        self.bytes.resize(self.bytes.len() + count, 0);
    }
}

/// `length` numbers of an array, written straight into the column: no intermediate `Vec`
/// per sphere or per bounds pair, identical bytes to value-by-value writes.
pub(crate) fn vector_into(
    value: Option<&Value>,
    length: usize,
    what: &str,
    column: &mut Column,
) -> Result<()> {
    let items = MANIFEST.array(
        value.ok_or_else(|| MANIFEST.bad(format!("{what} is absent")))?,
        what,
    )?;
    if items.len() != length {
        return Err(MANIFEST.bad(format!(
            "{what} has {} numbers, expected {length}",
            items.len()
        )));
    }
    numbers_into(items, what, column)
}
/// All numbers of an array, written straight into the column. The name of a faulty entry is
/// constructed only when there is one: building it always would format a string per valid
/// number, sphere after sphere, culling node after culling node.
pub(crate) fn numbers_into(items: &[Value], what: &str, column: &mut Column) -> Result<()> {
    for (i, item) in items.iter().enumerate() {
        let Some(value) = item.as_f64() else {
            return Err(MANIFEST.bad(format!("{what}[{i}] is not a number")));
        };
        column.f64(value);
    }
    Ok(())
}
pub(super) fn as_i32(value: i64, what: &str) -> Result<i32> {
    i32::try_from(value)
        .map_err(|_| MANIFEST.bad(format!("{what} does not fit a 32-bit integer: {value}")))
}
pub(super) fn as_u32(value: i64, what: &str) -> Result<u32> {
    u32::try_from(value).map_err(|_| {
        MANIFEST.bad(format!(
            "{what} does not fit an unsigned 32-bit integer: {value}"
        ))
    })
}
