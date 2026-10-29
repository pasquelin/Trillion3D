//! What lies behind a merged mesh's translucent texels (`Behind`): every part of the merged mesh
//! traced in world space wearing its material, in the leaf order of the tree over them, which the
//! rays from a translucent texel's point inward along its vertex normal walk on the GPU
//! (`gpu/tile.wgsl`'s `seen_behind`). The texels of a translucent entry read their own triangles
//! among them (`Behind::slots`), so one scene holds the entry and what lies behind it.
use crate::hlod::flatten::bake::sources::{Library, Piece, Sources};
use crate::hlod::flatten::bake::tree::order_sources;
use trillion3d_page_codec::proxy::bvh::Node;

/// What lies behind a merged mesh's translucent texels (module doc): every part of the merged
/// mesh traced in world space wearing its material, and the tree over them.
pub(in crate::hlod) struct Behind {
    pub(super) sources: Sources,
    pub(super) nodes: Vec<Node>,
    /// Per triangle, in the parts' order, its slot in the tree's leaf order.
    slots: Vec<usize>,
    /// Per part, the rank of its first triangle.
    starts: Vec<usize>,
}

impl Behind {
    /// What lies behind any texel of `pieces`, the merged mesh's parts, each wearing its material
    /// of `library`.
    pub(in crate::hlod) fn of<'a>(
        pieces: impl IntoIterator<Item = Piece<'a>>,
        library: &Library,
    ) -> Self {
        let pieces: Vec<Piece> = pieces.into_iter().collect();
        let pieces = pieces.as_slice();
        let mut starts = Vec::with_capacity(pieces.len());
        let mut triangles = 0;
        for piece in pieces {
            starts.push(triangles);
            triangles += piece.indices.len() / 3;
        }
        let mut sources = Sources::of(pieces, library);
        let (nodes, order) = order_sources(&mut sources.mesh);
        let mut slots = vec![0; order.len()];
        for (slot, &rank) in order.iter().enumerate() {
            slots[rank] = slot;
        }
        Self {
            sources,
            nodes,
            slots,
            starts,
        }
    }

    /// The slots of the triangles of `parts`, each a part `of` was given, in order: the places of
    /// the entry made of them among what lies behind it.
    pub(in crate::hlod) fn slots(&self, parts: impl IntoIterator<Item = usize>) -> Vec<usize> {
        let mut slots = Vec::new();
        for part in parts {
            let next = self.starts.get(part + 1);
            let end = next.copied().unwrap_or(self.slots.len());
            slots.extend_from_slice(&self.slots[self.starts[part]..end]);
        }
        slots
    }
}
