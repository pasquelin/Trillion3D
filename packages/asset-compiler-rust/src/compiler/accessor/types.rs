use crate::compiler::accessor::codes::{UNSIGNED_BYTE, UNSIGNED_INT, UNSIGNED_SHORT};
use crate::*;

/// The unsigned integer that a glTF index component (`INDEX_COMPONENTS`) holds at the start of
/// `bytes`, or `None` for another component or too few bytes: the one reading of those types.
pub(crate) fn index_value(component: usize, bytes: &[u8]) -> Option<u32> {
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
pub(crate) fn reserve<T>(n: usize) -> Result<Vec<T>> {
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
pub(crate) fn reserve_more<T>(out: &mut Vec<T>, additional: usize, message: &str) -> Result<()> {
    out.try_reserve_exact(additional)
        .map_err(|_| CompilerError::new("RAM_ADMISSION_BUDGET_EXCEEDED", message))
}
pub(crate) struct Accessor<'a> {
    pub(crate) bin: &'a [u8],
    pub(crate) base: usize,
    pub(crate) stride: usize,
    pub(crate) count: usize,
    pub(crate) component: usize,
    pub(crate) bytes: usize,
    pub(crate) width: usize,
    pub(crate) normalized: bool,
    pub(crate) has_buffer_view: bool,
    /// The sparse substitution, over the same binary (`accessor_validation::layout`).
    pub(crate) sparse: Option<super::layout::Sparse>,
}
