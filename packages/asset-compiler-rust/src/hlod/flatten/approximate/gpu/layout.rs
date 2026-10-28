//! The layout the CPU packs and the two query passes read, written once: every record's size in
//! `vec4` words, the scene's head, the walk's bounds. The shaders hold none of these numbers; they
//! read them from the prelude generated here (`prelude`). What it lays out like the bake — the
//! workgroup, the stack, the bindings — lives in `flatten/gpu/layout.rs`.
use crate::hlod::flatten::approximate::winding::SHELL_WINDING;
use crate::hlod::flatten::gpu::layout::{
    stack, wgsl_constants, NONE, READ, UNIFORM, WORKGROUP, WRITE,
};
use trillion3d_page_codec::proxy::PROXY_CHILDREN;

/// The bit a binary tree node's first link carries when it is a leaf: its range follows.
pub(crate) const LEAF: u32 = 1 << 31;
/// The deepest tree a walk takes, edges from the root to a leaf: far past any balanced tree over
/// the triangles a shell reads.
pub(crate) const MAX_DEPTH: usize = 24;
/// The walk's stack: no walk of a tree within `MAX_DEPTH` overflows it, nor the walk of a binary
/// tree within `BINARY_DEPTH`.
pub(crate) const STACK: usize = stack(MAX_DEPTH);
/// The deepest binary tree a walk takes — a winding field's, the instances' box tree —: each
/// level holds one sibling waiting, and the node in hand.
pub(crate) const BINARY_DEPTH: usize = STACK - 1;
/// The scene's head: two records of bases and counts (`super::Head`).
pub(crate) const HEAD_RECORDS: usize = 2;
/// A winding field's node: its expansion's centre and the square of its reach — the largest
/// float where it is never read from afar —, its area vectors' sum and its second-order sum row by
/// row, then its box's low corner and its first link — its left child, or `LEAF` and its first
/// triangle —, its box's high corner and its second link — its right child, or its triangles' end.
pub(crate) const FIELD_NODE_RECORDS: usize = 6;
/// A boxed tree node: its low corner, its high corner, its children, a leaf's first slot and
/// count.
pub(crate) const BOX_NODE_RECORDS: usize = 4;
/// A triangle's three corners.
pub(crate) const TRIANGLE_RECORDS: usize = 3;
/// A wrapped mesh: its field's first node, its first triangle, and its shell's radius, zero for
/// none.
pub(crate) const MESH_RECORDS: usize = 1;
/// An instance: its box's low corner and its mesh's rank, its high corner, then the three rows of
/// the transform bringing a point of the scene into its mesh's space about the mesh's centre, each
/// its linear row and its shift.
pub(crate) const INSTANCE_RECORDS: usize = 5;
/// A node of the tree over the instances' boxes: its low corner and its left child — or `LEAF`
/// and its first instance —, its high corner and its right child — or its instances' end.
pub(crate) const BOUND_RECORDS: usize = 2;
/// What the nearest pass writes for a point no triangle lies within the limit of.
pub(crate) const MISS: f32 = -1.0;

/// The constants above as WGSL, put before the shaders' own text.
pub(super) fn prelude() -> String {
    let constants = [
        ("NONE", NONE as usize),
        ("LEAF", LEAF as usize),
        ("WORKGROUP", WORKGROUP),
        ("STACK", STACK),
        ("CHILDREN", PROXY_CHILDREN),
        ("FIELD_NODE_RECORDS", FIELD_NODE_RECORDS),
        ("BOX_NODE_RECORDS", BOX_NODE_RECORDS),
        ("TRIANGLE_RECORDS", TRIANGLE_RECORDS),
        ("MESH_RECORDS", MESH_RECORDS),
        ("INSTANCE_RECORDS", INSTANCE_RECORDS),
        ("BOUND_RECORDS", BOUND_RECORDS),
    ];
    let mut out = wgsl_constants(&constants);
    out += &format!("const MISS: f32 = {MISS:?};\n");
    out += &format!("const SHELL_WINDING: f32 = {:?};\n", SHELL_WINDING as f32);
    out
}

/// The bindings in order: the chunk's uniform, the scene and the points read, the values written.
pub(crate) fn bindings() -> Vec<wgpu::BindingType> {
    vec![UNIFORM, READ, READ, WRITE]
}
