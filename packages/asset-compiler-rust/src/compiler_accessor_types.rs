use super::*;
use crate::gltf_codes::{UNSIGNED_BYTE, UNSIGNED_INT, UNSIGNED_SHORT};

/// The unsigned integer that a glTF index component (`INDEX_COMPONENTS`) holds at the start of
/// `bytes`, or `None` for another component or too few bytes: the one reading of those types.
pub(super) fn index_value(component: usize, bytes: &[u8]) -> Option<u32> {
    Some(match component {
        UNSIGNED_BYTE => u32::from(*bytes.first()?),
        UNSIGNED_SHORT => u32::from(u16::from_le_bytes(*bytes.first_chunk()?)),
        UNSIGNED_INT => u32::from_le_bytes(*bytes.first_chunk()?),
        _ => return None,
    })
}
/// Fallible reservation of a dense expansion. A capacity no machine can address
/// describes an invalid file; an allocation failure describes a memory-budget
/// overrun: neither must terminate the process, which is what `Vec::with_capacity`
/// would do.
pub(super) fn reserve<T>(n: usize) -> Result<Vec<T>> {
    if n.checked_mul(size_of::<T>())
        .is_none_or(|bytes| bytes > isize::MAX as usize)
    {
        return Err(invalid("Accessor expansion exceeds addressable memory"));
    }
    let mut out = Vec::new();
    reserve_more(&mut out, n, "Accessor expansion could not be allocated")?;
    Ok(out)
}
/// `try_reserve_exact` of `additional` more in `out`; a failure is a memory-budget overrun.
pub(super) fn reserve_more<T>(out: &mut Vec<T>, additional: usize, message: &str) -> Result<()> {
    out.try_reserve_exact(additional)
        .map_err(|_| CompilerError::new("RAM_ADMISSION_BUDGET_EXCEEDED", message))
}
pub(super) struct Accessor<'a> {
    pub(super) bin: &'a [u8],
    pub(super) base: usize,
    pub(super) stride: usize,
    pub(super) count: usize,
    pub(super) component: usize,
    pub(super) bytes: usize,
    pub(super) width: usize,
    pub(super) normalized: bool,
    pub(super) has_buffer_view: bool,
    /// The sparse substitution, over the same binary (`accessor_validation::layout`).
    pub(super) sparse: Option<accessor_validation::Sparse>,
}
