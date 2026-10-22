//! One bake's scene as the compute passes read it, one buffer of `vec4` words, with the materials'
//! head and the surfaces' records beside it. A capture's scene holds the shell's frames, the tree
//! over the sources, the sources' corners and attributes in the tree's leaf order (`records.rs`),
//! the tree over the shell, the shell's corners in its leaf order and the views; a tile's
//! (`tiles.rs`) the sources and the triangles' places in their image. The surfaces they wear
//! (`surfaces.rs`) come with the chains those read, each chain once however many surfaces read it.
//! Positions are taken about the sources' centre, so single precision keeps the detail of a cell
//! far from the scene's origin.
use super::super::capture::Views;
use super::super::sources::Sources;
use super::super::tree::{soup, Tree};
use super::super::Flat;
use super::frames::pack_frames;
use super::layout::{HEAD_RECORDS, MAX_DEPTH};
use super::records::{pack_nodes, pack_sources};
use super::surfaces::pack_surfaces;
use crate::hlod::flatten::gpu::pack::{base, check_depth, float, local};
use crate::trace::surface::material::Texels;
use std::sync::Arc;
use trillion3d_math::geometry::aabb::aabb_of_f32;
use trillion3d_math::vector::vecn::{length, sub};
use trillion3d_page_codec::proxy::bvh::Node;

/// How far a capture's visibility ray starts off the shell, over the shell box's least side: a
/// hundred single-precision zero tolerances, so the ray leaves the triangle it starts on.
const SHELL_OFFSET: f64 = 100.0 * 1e-6;

/// How far past a translucent layer a view's ray goes on (`capture.wgsl`'s `view_pixel`), over
/// the farthest a coordinate it reads lies from the sources' centre — a view's eye, plus the
/// sources' radius —: sixteen single-precision roundings, as two hits that close are one surface
/// (`Traceable::tie`), so a ray leaves the layer it met and the triangles beside it on that pane.
const LAYER_GAP: f64 = 16.0 * f32::EPSILON as f64;

/// A bake's scene: its words; the materials' head (`layout::HEAD_RECORDS`) — its first word, the
/// first texture record, left for the bake to set once the surfaces are counted (`run.rs`), then
/// the view count, the image side and the shell offset's bits; the `vec4` bases of the frames,
/// nodes, corners and attributes — the frames' always zero, as they come first, kept so the
/// shaders address every section alike (`scene.wgsl`'s `bases`); a capture's shell nodes and
/// corners' and its views' bases, a tile's laid triangles'; whether a translucent source is seen
/// through, the layer gap's bits (`LAYER_GAP`, a tile's `Traceable::tie`), the textures'
/// anisotropy clamp and what a tile bakes —; its surfaces' records, their maps naming the chains
/// by rank in `chains`.
pub(super) struct Scene {
    pub words: Vec<u32>,
    pub head: [[u32; 4]; HEAD_RECORDS],
    pub surfaces: Vec<u32>,
    pub chains: Vec<Arc<Texels>>,
}

/// A capture's views about `origin` (`layout::VIEW_RECORDS`): each one's eye and near plane's
/// distance, its sight and its image's half side on the near plane, its image's right, its
/// image's up.
fn pack_views(out: &mut Vec<u32>, views: &Views, origin: [f64; 3]) {
    for view in &views.views {
        let [sight, right, up] = view.axes;
        out.extend(local(view.origin, origin).map(f32::to_bits));
        out.push(float(views.near));
        out.extend(sight.map(float));
        out.push(float(views.half_side));
        for axis in [right, up] {
            out.extend(axis.map(float));
            out.push(0);
        }
    }
}

/// The tree over `flat`'s triangles about `origin`: its nodes, then its triangles' corners in
/// leaf order (`layout::CORNER_RECORDS`); the `vec4` bases of both.
fn pack_shell(out: &mut Vec<u32>, flat: &Flat, origin: [f64; 3]) -> crate::Result<[u32; 2]> {
    let tree = Tree::from_soup(soup(&flat.positions, &flat.indices));
    check_depth(&tree.nodes, MAX_DEPTH, "the tree over its shell")?;
    let nodes_at = base(out);
    pack_nodes(out, &tree.nodes, origin);
    let corners_at = base(out);
    for slot in 0..tree.triangles.len() / 9 {
        for corner in tree.corners(slot) {
            out.extend(local(corner, origin).map(f32::to_bits));
            out.push(0);
        }
    }
    Ok([nodes_at, corners_at])
}

impl Scene {
    /// The shell `flat` over `sources`, read through `views` of them, a translucent source seen
    /// through when `seen_through`, their rays walking the tree `nodes` over them.
    pub fn captured(
        flat: &Flat,
        sources: &Sources,
        (nodes, views, seen_through): (&[Node], &Views, bool),
    ) -> crate::Result<Self> {
        let mesh = &sources.mesh;
        let origin = mesh.centre;
        let mut words = Vec::new();
        pack_frames(&mut words, flat, origin);
        let [nodes_at, corners_at, attributes_at] = pack_sources(&mut words, mesh, nodes)?;
        let [shell_nodes, shell_corners] = pack_shell(&mut words, flat, origin)?;
        let views_at = base(&words);
        pack_views(&mut words, views, origin);
        let (low, high) = aabb_of_f32(flat.positions.as_chunks::<3>().0.iter().copied());
        let least = (0..3)
            .map(|k| f64::from(high[k] - low[k]))
            .fold(f64::MAX, f64::min);
        let offset = float(SHELL_OFFSET * least);
        let eye = (views.views.iter())
            .map(|view| length(sub(view.origin, origin)))
            .fold(0.0, f64::max);
        let gap = float(LAYER_GAP * (eye + mesh.radius));
        let head = [
            [0, views.views.len() as u32, views.side as u32, offset],
            [0, nodes_at, corners_at, attributes_at],
            [shell_nodes, shell_corners, views_at, 0],
            [u32::from(seen_through), gap, views.anisotropy as u32, 0],
        ];
        let (surfaces, chains) = pack_surfaces(sources, (false, false));
        Ok(Self {
            words,
            head,
            surfaces,
            chains,
        })
    }
}
