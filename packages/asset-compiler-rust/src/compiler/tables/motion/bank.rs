//! The scene's animation banks, `animation-banks.bin` (docs/FORMAT.md): the clips its instanced
//! skinned objects play, baked once at compile time so that every instance of one item plays one
//! track on the GPU, with no skeleton of its own.
//!
//! An instanced skinned object is a leaf node drawing, through a skin, a mesh with no morph target,
//! which its settings name `skinnedInstance` (`ObjectSettings::node`). What it plays is a bake — a
//! (skin, clip) sampled —, each pair sampled once whatever the objects playing it:
//! `N = max(1, round(duration · ANIMATION_BANK_SAMPLE_RATE))` frames, frame `f` at
//! `f / ANIMATION_BANK_SAMPLE_RATE` seconds (`Clip::frames`); at each, every node from the skin's
//! frame down to each joint (`Chain`) takes its local pose — the sampled one where the clip moves
//! it (`sample.rs`), its declared one otherwise —, and joint `j`'s transform `M_j` in the frame's
//! space is the product of those from the frame down. Each `M_j` must be rigid — its linear part's
//! columns orthonormal within `RIGID_TOLERANCE`, its determinant positive —, or the bake is
//! refused and the object left to its host's skeleton: a key holds `M_j`'s translation and
//! rotation alone. Its inverse binds are the skin's, identities when it declares none. Two bakes of
//! the same floats, bit for bit — the crowds made of copied skins —, are one.
//!
//! An item is what an object plays: its mesh, its bake and its settings; objects of the same three
//! play one item, one track at run time. Its sampled bounds, in its frame's space, are its mesh's
//! box grown by every key's translation, their half extent then scaled by `boundsScale` about their
//! centre; its start position is clamped to its clip's duration.
//!
//! The file is little-endian 4-byte words: the header (`ANIMATION_BANKS_HEADER_WORDS`: magic,
//! version, bakes, items, the pool's floats); each bake (`ANIMATION_BANK_BAKE_WORDS`: joints,
//! frames, the pool float its inverse binds start at, the one its keys start at); each item
//! (`ANIMATION_BANK_ITEM_WORDS`: bake, flags — `ANIMATION_BANK_LOOPING` —, start position, play
//! rate and screen size as `f32`, the low then the high corner of its bounds as `f32`, its
//! published mesh); then the `f32` pool: per bake its inverse binds, the three rows of each joint's
//! affine part (`ANIMATION_BANK_INVERSE_FLOATS`), and its keys, frame by frame and joint by joint,
//! the translation then the rotation quaternion `x, y, z, w` (`ANIMATION_BANK_KEY_FLOATS`).
//!
//! Its folder holds the stages: a skin's joints posed through a clip frame by frame, with the
//! bounds of a plain skinned node (`poses.rs`); what an object may play (`select.rs`); the bakes,
//! each sampled and kept once (`bakes.rs`); and the file's bytes (`encode.rs`).
use super::super::graph::node_parents;
use super::sample::Clip;
use super::*;
use crate::compiler::validate::OPTIONS;
use std::collections::btree_map::Entry;
use trillion3d_math::geometry::aabb::grow_flat;

mod bakes;
mod encode;
mod poses;
mod select;
use bakes::{bake, Bakes, Skin};
use encode::encode;
pub(crate) use poses::animated_bounds;
use select::{bankable, chosen, index, scaled};

// The file's name and layout numbers, which the generator copies to TypeScript
// (`scripts/build/shared-rules/formats.ts`, `writtenFormats.ts`).

/// The animation banks' file, beside the scene tables.
pub(crate) const ANIMATION_BANKS_FILE: &str = "animation-banks.bin";
/// Version of the animation banks' file: one of another version is refused, never guessed.
pub(crate) const ANIMATION_BANKS_VERSION: u32 = 1;
/// 'T','B','N','K' read as an unsigned 32-bit integer little-endian.
pub(crate) const ANIMATION_BANKS_MAGIC: u32 = 0x4b4e4254;
/// Header words of the animation banks' file: magic, version, the bakes, the items, and the
/// floats of the pool.
pub(crate) const ANIMATION_BANKS_HEADER_WORDS: usize = 5;
/// Words of a bake: its joints, its frames, and the pool floats its inverse binds and its keys
/// start at.
pub(crate) const ANIMATION_BANK_BAKE_WORDS: usize = 4;
/// Words of an item: its bake, its flags, its start position, play rate and screen size, its
/// bounds' low then high corner, and its published mesh.
pub(crate) const ANIMATION_BANK_ITEM_WORDS: usize = 12;
/// Floats of a key: the translation `x, y, z`, then the rotation quaternion `x, y, z, w`.
pub(crate) const ANIMATION_BANK_KEY_FLOATS: usize = 7;
/// Floats of an inverse bind: the three rows of its affine part, four floats each, row-major.
pub(crate) const ANIMATION_BANK_INVERSE_FLOATS: usize = 12;
/// The flag of an item whose track wraps at its end; one without it holds its last pose.
pub(crate) const ANIMATION_BANK_LOOPING: u32 = 1;

/// One instanced skinned object the banks hold.
pub(crate) struct Banked {
    pub item: usize,
    pub frame: Option<usize>,
    pub bounds: [f64; 6],
    pub hlod: bool,
}

/// The scene's banks: its objects by published node, the file's bytes (None when no item), and
/// the nodes a bank was refused to, with why.
#[derive(Default)]
pub(crate) struct Banks {
    pub objects: BTreeMap<usize, Banked>,
    pub file: Option<Vec<u8>>,
    pub items: usize,
    pub refused: Vec<(usize, String)>,
}

/// A bake as the file holds it: its joints, its frames, and its floats — the inverse binds, then
/// the keys.
struct Bake {
    joints: usize,
    frames: usize,
    floats: Vec<f32>,
}

/// What a (skin, clip) sampled gives its items: its bake's rank among the file's, the box of its
/// keys' translations, and its clip's duration.
#[derive(Clone, Copy)]
struct Sampled {
    bake: usize,
    reach: [f64; 6],
    duration: f64,
}

/// An item as the file holds it, its mesh the published one.
struct Item {
    bake: usize,
    looping: bool,
    position: f64,
    play_rate: f64,
    min_screen_size: f64,
    bounds: [f64; 6],
    mesh: usize,
}

/// The scene's banks, as the module states them. `g` is the input scene and `bin` its binary;
/// `boxes` holds each input mesh's box (`mesh_boxes`), and `mesh_map` each input mesh's published
/// rank — a node whose mesh it does not hold was not chosen, and is skipped. A node drawing a mesh
/// through a skin is banked when its settings name `skinnedInstance` (`ObjectSettings::node`),
/// refused with why when it cannot be. Each skin, clip and (skin, clip) is read or sampled once.
/// An object is HLOD-relevant when its mobility is (`Mobility::hlod_relevant`) and no animation
/// moves its frame or a node above it. `Err` when a node's settings name a clip no animation is
/// (`INVALID_OPTIONS`), or when the document does not read.
pub(crate) fn bake_banks(
    g: &Value,
    bin: &[u8],
    settings: &crate::ObjectSettings,
    boxes: &[Option<[f64; 6]>],
    mesh_map: &BTreeMap<usize, usize>,
) -> Result<Banks> {
    let nodes = values(g, "nodes")?;
    let parents = node_parents(nodes)?;
    let animations = g.get("animations").and_then(Value::as_array);
    let animations = animations.map_or(&[][..], Vec::as_slice);
    let moved = super::moved(g);
    let morphing = crate::compiler::tables::partition::boxes::morphing(g);
    let mut skins = BTreeMap::<usize, Skin>::new();
    let mut clips = BTreeMap::<usize, Clip>::new();
    let mut sampled = BTreeMap::<(usize, usize), std::result::Result<Sampled, String>>::new();
    let mut bakes = Bakes::default();
    let mut items = Vec::<Item>::new();
    let mut ranks = BTreeMap::new();
    let mut banks = Banks::default();
    for (node, declared) in nodes.iter().enumerate() {
        let (Some(mesh), Some(skin)) = (index(declared, "mesh")?, index(declared, "skin")?) else {
            continue;
        };
        let Some(&published) = mesh_map.get(&mesh) else {
            continue;
        };
        let Some(instance) = settings.node(g, node)?.skinned else {
            continue;
        };
        let mesh_box = match bankable(declared, mesh, (boxes, &morphing)) {
            Ok(mesh_box) => mesh_box,
            Err(why) => {
                banks.refused.push((node, why.into()));
                continue;
            }
        };
        if let Entry::Vacant(vacant) = skins.entry(skin) {
            vacant.insert(Skin::read(g, bin, &parents, skin)?);
        }
        let read = &skins[&skin];
        let Some(clip) = chosen(node, &instance, animations, &read.joints)? else {
            banks
                .refused
                .push((node, "no animation moves its skin".into()));
            continue;
        };
        if let Entry::Vacant(vacant) = sampled.entry((skin, clip)) {
            if let Entry::Vacant(unread) = clips.entry(clip) {
                unread.insert(Clip::read(g, bin, clip)?);
            }
            let played = &clips[&clip];
            let baked = bake(nodes, read, played)?.map(|(baked, reach)| Sampled {
                bake: bakes.rank(baked),
                reach,
                duration: played.duration,
            });
            vacant.insert(baked);
        }
        let played = match &sampled[&(skin, clip)] {
            Ok(played) => *played,
            Err(why) => {
                banks.refused.push((node, why.clone()));
                continue;
            }
        };
        let position = instance.position.clamp(0.0, played.duration);
        let mut grown = mesh_box;
        grow_flat(&mut grown, &played.reach);
        let bounds = scaled(&grown, instance.bounds_scale);
        let key = (
            (published, played.bake, instance.looping),
            [
                position,
                instance.play_rate,
                instance.min_screen_size,
                instance.bounds_scale,
            ]
            .map(f64::to_bits),
        );
        let item = *ranks.entry(key).or_insert_with(|| {
            items.push(Item {
                bake: played.bake,
                looping: instance.looping,
                position,
                play_rate: instance.play_rate,
                min_screen_size: instance.min_screen_size,
                bounds,
                mesh: published,
            });
            items.len() - 1
        });
        let frame = read.chain.frame;
        let still = std::iter::successors(frame, |&at| parents[at]).all(|at| !moved.contains(&at));
        let hlod = instance.mobility.hlod_relevant() && still;
        let banked = Banked {
            item,
            frame,
            bounds,
            hlod,
        };
        banks.objects.insert(node, banked);
    }
    banks.items = items.len();
    banks.file = if items.is_empty() {
        None
    } else {
        Some(encode(&bakes.list, &items)?)
    };
    Ok(banks)
}
