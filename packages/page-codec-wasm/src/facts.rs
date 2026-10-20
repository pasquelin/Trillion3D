//! What a page's geometry descriptor says of it, whatever page it is: a `WGP3` page's
//! (`encode::Encoded::facts`) and a voxel page's (`voxel::VoxelPage::facts`) alike, so a writer of
//! descriptors reads one type.

/// A page and its descriptor's facts: its bytes, vertex and index counts, flags, decoded bytes,
/// quantization error and the triangles it draws.
#[derive(Debug)]
pub struct PageFacts {
    pub bytes: Vec<u8>,
    pub vertex_count: usize,
    pub index_count: usize,
    pub flags: u32,
    pub decoded_bytes: usize,
    pub quantization_error: f32,
    pub triangles: usize,
}

impl crate::encode::Encoded {
    /// The page's facts, its header's, the page drawing `triangles` triangles.
    pub fn facts(self, triangles: usize) -> PageFacts {
        PageFacts {
            vertex_count: self.header.vertex_count,
            index_count: self.header.index_count,
            flags: self.header.flags,
            decoded_bytes: self.header.decoded_bytes(),
            quantization_error: self.header.quantization_error,
            triangles,
            bytes: self.bytes,
        }
    }
}
