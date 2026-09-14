use super::*;

pub(super) struct SparseAccessor<'a> {
    pub(super) count: usize,
    pub(super) indices_bin: &'a [u8],
    pub(super) indices_offset: usize,
    pub(super) indices_component: usize,
    pub(super) values_bin: &'a [u8],
    pub(super) values_offset: usize,
}
impl SparseAccessor<'_> {
    pub(super) fn index(&self, offset: usize, count: usize) -> Result<usize> {
        let index = match self.indices_component {
            5121 => *self
                .indices_bin
                .get(self.indices_offset + offset)
                .ok_or_else(|| invalid("Sparse index out of bounds"))? as usize,
            5123 => {
                let start = self.indices_offset + offset * 2;
                let bytes = self
                    .indices_bin
                    .get(start..start + 2)
                    .ok_or_else(|| invalid("Sparse index out of bounds"))?;
                u16::from_le_bytes([bytes[0], bytes[1]]) as usize
            }
            5125 => {
                let start = self.indices_offset + offset * 4;
                let bytes = self
                    .indices_bin
                    .get(start..start + 4)
                    .ok_or_else(|| invalid("Sparse index out of bounds"))?;
                u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize
            }
            _ => return Err(invalid("Unsupported sparse indices component")),
        };
        if index >= count {
            return Err(CompilerError::new(
                "INDEX_OUT_OF_BOUNDS",
                "Sparse index exceeds count",
            ));
        }
        Ok(index)
    }
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
