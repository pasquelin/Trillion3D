//! A primitive's tree, built and encoded: its DAG's coarse cut (`cut.rs`), the binary tree over
//! the cut's triangles (`bvh.rs`) collapsed into eight children a node (`wide.rs`), as bytes
//! (`nodes.rs`), ready for the file (`encode.rs`). No tree needs the walk's stack to hold more than
//! `RAY_TRACING_STACK` nodes (`within_stack`).
use super::abi::{
    RAY_TRACING_FLAG_ACTOR, RAY_TRACING_FLAG_ATTRIBUTES, RAY_TRACING_FLAG_MASKED,
    RAY_TRACING_FLAG_NORMALS, RAY_TRACING_FLAG_TRANSLUCENT, RAY_TRACING_FLAG_TWO_SIDED,
    RAY_TRACING_FLAG_WORLD, RAY_TRACING_NODE_BYTES, RAY_TRACING_NO_PRIMITIVE, RAY_TRACING_STACK,
    RAY_TRACING_TRIANGLE_BYTES,
};
use super::attributes::TRIANGLE_ATTRIBUTE_BYTES;
use super::bvh::{build, Binary, Item};
use super::cut::{cut_of, Cut};
use super::nodes::{write_node, write_triangle};
use super::wide::{collapse, stack_need, Wide};
use crate::compiler::materials::AlphaMode;
use crate::dag::DagCluster;
use crate::{CompilerError, Result};
use serde_json::Value;
use trillion3d_page_codec::encode::Attribute;

/// What names a primitive's tree and says how a ray treats it: the primitive's compiled mesh and
/// its number in the mesh, the two numbers a placed root names its primitive by, the flags of
/// its material (`material_flags`) and, for an HLOD actor's, the cell that shows it.
#[derive(Clone, Copy, Default)]
pub(crate) struct Traced {
    pub mesh: u32,
    pub primitive: u32,
    pub flags: u32,
    pub cell: u32,
}

impl Traced {
    /// The world's directory: no primitive (`RAY_TRACING_NO_PRIMITIVE`), the world's flag
    /// (`RAY_TRACING_FLAG_WORLD`) (`world.rs`).
    pub(super) const WORLD: Self = Self {
        mesh: RAY_TRACING_NO_PRIMITIVE,
        primitive: RAY_TRACING_NO_PRIMITIVE,
        flags: RAY_TRACING_FLAG_WORLD,
        cell: 0,
    };

    /// An HLOD actor's record: no primitive, the actor's flag over its material's `flags`, shown
    /// by HLOD cell `cell`.
    pub(super) const fn actor(flags: u32, cell: u32) -> Self {
        Self {
            mesh: RAY_TRACING_NO_PRIMITIVE,
            primitive: RAY_TRACING_NO_PRIMITIVE,
            flags: RAY_TRACING_FLAG_ACTOR | flags,
            cell,
        }
    }
}

/// The tree of a primitive: what names it, the error of its cut, the box of its triangles, and the
/// bytes of its nodes and of its triangles, then those of its triangles' corners' attributes
/// (`attributes.rs`) in the same order, none for a tree whose cut carries none.
pub(crate) struct PrimitiveTree {
    pub(super) traced: Traced,
    pub(super) error: f32,
    pub(super) low: [f32; 3],
    pub(super) high: [f32; 3],
    pub(super) nodes: Vec<u8>,
    pub(super) triangles: Vec<u8>,
    pub(super) attributes: Vec<u8>,
}

impl PrimitiveTree {
    pub(super) fn node_count(&self) -> usize {
        self.nodes.len() / RAY_TRACING_NODE_BYTES
    }

    pub(super) fn triangle_count(&self) -> usize {
        self.triangles.len() / RAY_TRACING_TRIANGLE_BYTES
    }
}

/// The flags of a primitive drawn with `material` (none for a primitive without one): whether it
/// is double-sided, alpha-masked, or translucent — `translucent` is the engine's own judgement,
/// blended or transmissive (`drawn_blended`).
pub(crate) fn material_flags(material: Option<&Value>, translucent: bool) -> u32 {
    let two_sided = material.is_some_and(|m| m["doubleSided"].as_bool() == Some(true));
    let masked = material.is_some_and(|m| matches!(AlphaMode::of(m), AlphaMode::Mask(_)));
    (u32::from(two_sided) * RAY_TRACING_FLAG_TWO_SIDED)
        | (u32::from(masked) * RAY_TRACING_FLAG_MASKED)
        | (u32::from(translucent) * RAY_TRACING_FLAG_TRANSLUCENT)
}

/// The tree of the primitive `traced` names, whose DAG is `clusters`, over the vertices
/// `positions` and the attributes `carried`; none when its cut holds no triangle, an error when it is too large (`within_stack`).
pub(crate) fn primitive_tree(
    positions: &[f32],
    carried: &[&Attribute],
    clusters: &[DagCluster],
    traced: Traced,
) -> Result<Option<PrimitiveTree>> {
    tree_of(cut_of(positions, carried, clusters)?, traced)
}

/// The binary tree over `items` and the wide tree collapsed from it whose walk needs no more than
/// `limit` nodes of stack (`stack_need`): the one split at the cheapest cuts, else the one split in
/// halves, as shallow as a tree can be. A tree needing more than `limit` even so is too large to
/// write: the compiler stops with `RAY_TRACING_TREE_TOO_DEEP` rather than writes a tree a ray could
/// not walk whole.
pub(super) fn within_stack(items: &[Item], limit: usize) -> Result<(Binary, Wide)> {
    let cheapest = build(items, false);
    let wide = collapse(&cheapest);
    if stack_need(&wide) <= limit {
        return Ok((cheapest, wide));
    }
    let even = build(items, true);
    let wide = collapse(&even);
    let need = stack_need(&wide);
    if need > limit {
        return Err(CompilerError::new(
            "RAY_TRACING_TREE_TOO_DEEP",
            format!(
                "a ray tracing tree of {} triangles needs {need} nodes of stack even split in halves, past the {limit} the walk holds",
                items.len()
            ),
        ));
    }
    Ok((even, wide))
}

/// The tree of the triangles of `cut`, named `traced`; none when the cut holds none, an error when
/// the tree is too large (`within_stack`).
pub(super) fn tree_of(cut: Cut, traced: Traced) -> Result<Option<PrimitiveTree>> {
    if cut.triangles.is_empty() {
        return Ok(None);
    }
    let items: Vec<Item> = cut.triangles.iter().map(Item::of).collect();
    let (binary, wide) = within_stack(&items, RAY_TRACING_STACK)?;
    let (low, high) = binary.nodes[0].bounds;
    let mut nodes = Vec::with_capacity(wide.nodes.len() * RAY_TRACING_NODE_BYTES);
    for node in &wide.nodes {
        write_node(node, &mut nodes);
    }
    let mut triangles = Vec::with_capacity(wide.triangles.len() * RAY_TRACING_TRIANGLE_BYTES);
    let mut attributes = Vec::with_capacity(
        wide.triangles.len() * TRIANGLE_ATTRIBUTE_BYTES * usize::from(cut.attributed),
    );
    for &item in &wide.triangles {
        write_triangle(&cut.triangles[item], &mut triangles);
        if cut.attributed {
            attributes.extend_from_slice(&cut.triangles[item].attributes);
        }
    }
    let traced = Traced {
        flags: traced.flags
            | RAY_TRACING_FLAG_ATTRIBUTES * u32::from(cut.attributed)
            | RAY_TRACING_FLAG_NORMALS * u32::from(cut.normalled),
        ..traced
    };
    Ok(Some(PrimitiveTree {
        traced,
        error: cut.error,
        low,
        high,
        nodes,
        triangles,
        attributes,
    }))
}
