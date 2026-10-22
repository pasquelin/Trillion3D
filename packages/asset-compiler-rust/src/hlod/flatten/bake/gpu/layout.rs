//! The layout the CPU packs and the compute passes read, written once: every record's size in
//! `vec4` words, the tables' places, the passes' bounds. The shaders hold none of these numbers;
//! they read them from the prelude generated here (`prelude`), so a record packed one word longer
//! is read one word longer. What it lays out like the shell's queries — the workgroup, the stack,
//! the bindings — lives in `flatten/gpu/layout.rs`.
use super::super::seen::LAYERS;
use super::super::sources::{CLAMP, MIRROR};
use crate::hlod::flatten::gpu::layout::{
    stack, wgsl_constants, NONE, READ, UNIFORM, WORKGROUP, WRITE,
};
use trillion3d_page_codec::proxy::PROXY_CHILDREN;

/// The deepest tree the walk takes, edges from the root to a leaf: a balanced tree of
/// `PROXY_CHILDREN` children and leaves of eight holds 8·4¹² ≈ 134 million triangles there.
pub(super) const MAX_DEPTH: usize = 12;
/// The walk's stack: no walk of a tree within `MAX_DEPTH` overflows it.
pub(super) const STACK: usize = stack(MAX_DEPTH);
/// The texture pages one bake binds at once, each its own storage binding.
pub(super) const PIXEL_PAGES: usize = 3;
/// The first page's binding: after the chunk's uniform, the scene, the materials, the texels and
/// the results (`bindings`).
pub(super) const PAGE_BINDING: u32 = 5;
/// Storage buffers the pass binds (`bindings`): every binding before the pages but the chunk's
/// uniform — the scene, the materials, the texels, the results —, then the pages. No program binds
/// more: the device is opened for these (`flatten/gpu/open.rs`).
pub(crate) const STORAGE_BUFFERS: u32 = PAGE_BINDING - 1 + PIXEL_PAGES as u32;

/// `vec4` records: a shell triangle's frame — three corners, three corner normals, three corner
/// tangents, each with its bitangent's sign.
pub(super) const FRAME_RECORDS: usize = 9;
/// A capture's view (`capture.wgsl`): its eye and near plane's distance, its direction and its
/// image's half side on the near plane, its image's right, its image's up.
pub(super) const VIEW_RECORDS: usize = 4;
/// A tree node: its low and high corners, its children (`NONE` past the last), a leaf's first slot
/// and count.
pub(super) const NODE_RECORDS: usize = 4;
/// A triangle's corners — a source's, the first's fourth word its surface's rank, or a capture's
/// shell's —.
pub(super) const CORNER_RECORDS: usize = 3;
/// A source triangle's attributes: three normals (the first's fourth word whether it has them, the
/// second's whether it has colours), both coordinate sets' corners in three records, three colours.
pub(super) const ATTRIBUTE_RECORDS: usize = 9;
/// The texture slots the passes read (`surfaces::READ_SLOTS`): base colour, metal-roughness, normal
/// map, emission, specular, occlusion, anisotropy.
pub(super) const READ_SLOT_COUNT: usize = 7;
/// A surface's records, in order: factor; roughness, metallic, normal scale, transmission; cutoff,
/// cut factor, whether it cuts, whether it blends; its first three slots' sets and every slot's
/// wraps (`sources::wraps_word`); its first three maps and whether it draws both faces; two
/// transform rows per slot read; its emission and specular input; its emission and specular maps
/// and their sets; its occlusion and anisotropy maps and their sets; the occlusion's strength, the
/// anisotropy's strength and its rotation (`surfaces::pack_surface`).
pub(super) const SURFACE_RECORDS: usize = SURFACE_STRENGTHS + 1;
/// A surface's first transform row's record.
pub(super) const SURFACE_TRANSFORMS: usize = 5;
/// A surface's emission and specular input's record.
pub(super) const SURFACE_LIT: usize = SURFACE_TRANSFORMS + 2 * READ_SLOT_COUNT;
/// A surface's emission and specular maps' record.
pub(super) const SURFACE_MORE: usize = SURFACE_LIT + 1;
/// A surface's occlusion and anisotropy maps' record.
pub(super) const SURFACE_EXTRA: usize = SURFACE_LIT + 2;
/// A surface's occlusion and anisotropy strengths' record.
pub(super) const SURFACE_STRENGTHS: usize = SURFACE_LIT + 3;
/// A texture: its first level's record, its level count, whether it reads sRGB, its page, the
/// finest levels it left out; then its finest level's sides.
pub(super) const TEXTURE_RECORDS: usize = 2;
/// The materials' head: the first texture record and a capture's view count, image side and
/// shell offset's bits; the scene's four bases; a capture's shell tree's nodes and corners and its
/// views, a tile's laid triangles; whether a translucent source is seen through, the step a ray
/// goes on by past one, the textures' anisotropy clamp and the maps a tile bakes
/// (`scene::Scene::head`, `tiles.rs`).
pub(super) const HEAD_RECORDS: usize = 4;
/// The tables after the head: the 256 sRGB bytes in linear, the 256 bytes on the unit interval.
pub(super) const TABLE_RECORDS: usize = (256 + 256) / 4;

/// `vec4` records: a source triangle's place in its tile's image — its footprint's barycentric
/// steps across one texel along `x` then `y`, and the deltas of its second and third corners'
/// coordinates from its first's (`tiles.rs`).
pub(super) const LAID_RECORDS: usize = 2;

/// What a tile bakes beside what every texel reads, the bits of the head's last word
/// (`tiles.rs`): its occlusion map,
pub(super) const MAP_OCCLUSION: u32 = 1;
/// its anisotropy map,
pub(super) const MAP_ANISOTROPY: u32 = 2;
/// its base alpha as the material's opacity,
pub(super) const MAP_BLEND: u32 = 4;
/// or as its mask.
pub(super) const MAP_MASK: u32 = 8;

/// The first surface's record in the materials, after the head and the tables.
pub(super) const SURFACES: usize = HEAD_RECORDS + TABLE_RECORDS;

/// The constants above as WGSL, and the pages' bindings with the one function that reads them,
/// put before the shaders' own text.
pub(super) fn prelude() -> String {
    let constants = [
        ("NONE", NONE as usize),
        ("WORKGROUP", WORKGROUP),
        ("STACK", STACK),
        ("CHILDREN", PROXY_CHILDREN),
        ("FRAME_RECORDS", FRAME_RECORDS),
        ("VIEW_RECORDS", VIEW_RECORDS),
        ("NODE_RECORDS", NODE_RECORDS),
        ("CORNER_RECORDS", CORNER_RECORDS),
        ("ATTRIBUTE_RECORDS", ATTRIBUTE_RECORDS),
        ("SURFACE_RECORDS", SURFACE_RECORDS),
        ("SURFACE_TRANSFORMS", SURFACE_TRANSFORMS),
        ("SURFACE_LIT", SURFACE_LIT),
        ("SURFACE_MORE", SURFACE_MORE),
        ("SURFACE_EXTRA", SURFACE_EXTRA),
        ("SURFACE_STRENGTHS", SURFACE_STRENGTHS),
        ("LAID_RECORDS", LAID_RECORDS),
        ("MAP_OCCLUSION", MAP_OCCLUSION as usize),
        ("MAP_ANISOTROPY", MAP_ANISOTROPY as usize),
        ("MAP_BLEND", MAP_BLEND as usize),
        ("MAP_MASK", MAP_MASK as usize),
        ("TEXTURE_RECORDS", TEXTURE_RECORDS),
        ("TABLES", HEAD_RECORDS),
        ("SURFACES", SURFACES),
        ("WRAP_CLAMP", CLAMP as usize),
        ("WRAP_MIRROR", MIRROR as usize),
        ("LAYERS", LAYERS),
    ];
    let mut out = wgsl_constants(&constants);
    for page in 0..PIXEL_PAGES {
        let binding = PAGE_BINDING as usize + page;
        out += &format!(
            "@group(0) @binding({binding}) var<storage, read> pixels{page}: array<u32>;\n"
        );
    }
    out += "fn pixel(page: u32, at: u32) -> u32 {\n";
    for page in 1..PIXEL_PAGES {
        out += &format!("    if page == {page}u {{\n        return pixels{page}[at];\n    }}\n");
    }
    out += "    return pixels0[at];\n}\n";
    out
}

/// The bindings in order: the chunk's uniform, the scene, the materials and the texels read, the
/// results written, the pages read.
pub(super) fn bindings() -> Vec<wgpu::BindingType> {
    let mut out = vec![UNIFORM, READ, READ, READ, WRITE];
    out.extend((0..PIXEL_PAGES).map(|_| READ));
    out
}
