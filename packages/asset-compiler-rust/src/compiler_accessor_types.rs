use super::*;

pub(super) struct SparseAccessor<'a> {
    pub(super) count: usize,
    pub(super) indices_bin: &'a [u8],
    pub(super) indices_offset: usize,
    pub(super) indices_component: usize,
    pub(super) values_bin: &'a [u8],
    pub(super) values_offset: usize,
}
/// The unsigned integer that a glTF index component (5121, 5123 or 5125) holds at the start of
/// `bytes`, or `None` for another component or too few bytes: the one reading of those types.
pub(super) fn index_value(component: usize, bytes: &[u8]) -> Option<u32> {
    Some(match component {
        5121 => u32::from(*bytes.first()?),
        5123 => u32::from(u16::from_le_bytes(*bytes.first_chunk()?)),
        5125 => u32::from_le_bytes(*bytes.first_chunk()?),
        _ => return None,
    })
}
impl SparseAccessor<'_> {
    pub(super) fn index(&self, offset: usize, count: usize) -> Result<usize> {
        let width = match self.indices_component {
            5121 => 1,
            5123 => 2,
            5125 => 4,
            _ => return Err(invalid("Unsupported sparse indices component")),
        };
        let start = self.indices_offset + offset * width;
        let index = self
            .indices_bin
            .get(start..start + width)
            .and_then(|bytes| index_value(self.indices_component, bytes))
            .ok_or_else(|| invalid("Sparse index out of bounds"))? as usize;
        if index >= count {
            return Err(CompilerError::new(
                "INDEX_OUT_OF_BOUNDS",
                "Sparse index exceeds count",
            ));
        }
        Ok(index)
    }
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
    out.try_reserve_exact(n).map_err(|_| {
        CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            "Accessor expansion could not be allocated",
        )
    })?;
    Ok(out)
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
    pub(super) sparse: Option<SparseAccessor<'a>>,
}
