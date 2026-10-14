//! glTF 2.0's numeric codes, named once: the accessor component types, their widths, and the
//! buffer view targets. Every reader and writer of the compiler's glTF spells them from here.

/// `componentType` of a signed byte.
pub(crate) const BYTE: usize = 5120;
/// `componentType` of an unsigned byte.
pub(crate) const UNSIGNED_BYTE: usize = 5121;
/// `componentType` of a signed 16-bit integer.
pub(crate) const SHORT: usize = 5122;
/// `componentType` of an unsigned 16-bit integer.
pub(crate) const UNSIGNED_SHORT: usize = 5123;
/// `componentType` of an unsigned 32-bit integer.
pub(crate) const UNSIGNED_INT: usize = 5125;
/// `componentType` of a 32-bit float.
pub(crate) const FLOAT: usize = 5126;
/// The component types an index list may use: the unsigned integers.
pub(crate) const INDEX_COMPONENTS: [usize; 3] = [UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT];

/// Buffer view `target` of vertex attributes.
pub(crate) const ARRAY_BUFFER: u32 = 34962;
/// Buffer view `target` of indices.
pub(crate) const ELEMENT_ARRAY_BUFFER: u32 = 34963;

/// Bytes of one component of `component`, `None` for a code glTF does not define.
pub(crate) fn component_bytes(component: usize) -> Option<usize> {
    match component {
        BYTE | UNSIGNED_BYTE => Some(1),
        SHORT | UNSIGNED_SHORT => Some(2),
        UNSIGNED_INT | FLOAT => Some(4),
        _ => None,
    }
}

/// Bytes of one index of `component`, `None` for a code that is no index type.
pub(crate) fn index_bytes_of(component: usize) -> Option<usize> {
    component_bytes(component).filter(|_| INDEX_COMPONENTS.contains(&component))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths_follow_the_component_types_and_floats_are_no_index() {
        assert_eq!(component_bytes(UNSIGNED_SHORT), Some(2));
        assert_eq!(component_bytes(FLOAT), Some(4));
        assert_eq!(component_bytes(5124), None);
        assert_eq!(index_bytes_of(UNSIGNED_BYTE), Some(1));
        assert_eq!(index_bytes_of(FLOAT), None);
        assert_eq!(index_bytes_of(SHORT), None);
    }
}
