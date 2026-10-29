//! The bakes' sources as pieces of the cell's original objects in world space (`Piece`), traced
//! in their materials (`traceable`), and what a bake reads of them beside that: how each surface's
//! samplers wrap its maps and whether it draws both faces (`Sources`).
use super::Library;
use crate::trace::surface::mesh::{Channel, Corners};
use crate::trace::surface::Traceable;
use std::collections::{BTreeMap, BTreeSet};
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// A piece of the sources in world space — an original object of the cell —: its material of the
/// source scene (its glTF rank, none for glTF's default), positions, the attributes its vertices
/// carry and its triangles.
pub(crate) struct Piece<'a> {
    pub material: Option<u64>,
    pub positions: &'a [f32],
    pub carried: &'a [Attribute],
    pub indices: &'a [u32],
}

/// The `width` floats of vertex `v` of `attribute`, none past its end.
fn value(attribute: &Attribute, v: usize) -> Option<&[f32]> {
    (attribute.values).get(v * attribute.width..(v + 1) * attribute.width)
}

/// `pieces` traced in world space, their triangles in order, each piece's material a surface of
/// `library`.
pub(crate) fn traceable(pieces: &[Piece], library: &Library) -> Traceable {
    let (mut triangles, mut tags, mut corners, mut surfaces) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut ranks: BTreeMap<Option<u64>, u32> = BTreeMap::new();
    for piece in pieces {
        let tag = *ranks.entry(piece.material).or_insert_with(|| {
            surfaces.push(library.surface(piece.material));
            (surfaces.len() - 1) as u32
        });
        // Each attribute the bake reads, found once per piece.
        let find = |flag: u32| piece.carried.iter().find(|a| a.flag == flag);
        let uvs = [FLAG_UV, FLAG_UV1].map(find);
        let (normals, colours) = (find(FLAG_NORMAL), find(FLAG_COLOR));
        for triangle in piece.indices.as_chunks::<3>().0 {
            for &v in triangle {
                let v = v as usize;
                triangles.extend_from_slice(&piece.positions[v * 3..v * 3 + 3]);
            }
            corners.push(Corners::of_triangle(
                triangle,
                (normals.is_some(), colours.is_some()),
                |channel, v| match channel {
                    Channel::Uv(set) => uvs[set].and_then(|a| value(a, v)),
                    Channel::Normal => normals.and_then(|a| value(a, v)),
                    Channel::Colour => colours.and_then(|a| value(a, v)),
                },
            ));
            tags.push(tag);
        }
    }
    Traceable::new(triangles, tags, corners, surfaces)
}

/// What a bake reads: its sources traced in world space (`traceable`), and per surface, in its
/// rank, how the samplers of the maps it reads wrap them (`wraps_word`) and whether it draws both
/// faces.
pub(crate) struct Sources {
    pub mesh: Traceable,
    pub wraps: Vec<u32>,
    pub double_sided: Vec<bool>,
}

impl Sources {
    /// `pieces` as a bake reads them, each wearing its material of `library`, wrapped as its
    /// samplers wrap its maps.
    pub(crate) fn of(pieces: &[Piece], library: &Library) -> Self {
        // Each material once, in the order the pieces first name it: the surfaces' ranks
        // (`traceable`).
        let mut named = BTreeSet::new();
        let (wraps, double_sided) = (pieces.iter())
            .map(|piece| piece.material)
            .filter(|&material| named.insert(material))
            .map(|material| {
                let drawn = library.drawn(material);
                (drawn.wraps, drawn.double_sided)
            })
            .unzip();
        Self {
            mesh: traceable(pieces, library),
            wraps,
            double_sided,
        }
    }
}
