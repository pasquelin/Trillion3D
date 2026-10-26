//! The displacement baked into a mesh, before its clusters are built: the mesh as the build's input
//! lays it — its triangle primitives, each with its vertices, the attributes the pages carry, and
//! the triangles over them — is tessellated as one soup and moved along its normals by its height
//! maps (`tessellate.rs`), each triangle by the map of its primitive's rank (its material), then
//! given back primitive by primitive.
//!
//! The error the tessellation holds the displacement to is `trimmedError`, in percent of the
//! mesh's size (`dag::relative_size`), a half again as much: the build tessellates a half finer
//! than the error it then simplifies back to. The tessellation works in centimetres, where its
//! thresholds are the reference's, so the mesh is brought to them and back.
use super::load::Bake;
use super::mesh::Soup;
use super::policy::Displacer;
use super::tessellate::tessellate;
use crate::simplify::CENTIMETRES;
use trillion3d_page_codec::clusters::named_bounds;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, UV_FLAGS};

/// A primitive once baked: its positions in metres, its attributes — the same kinds, in the same
/// order — and its triangles' corners.
pub(crate) struct Baked {
    pub positions: Vec<f32>,
    pub attributes: Vec<Attribute>,
    pub indices: Vec<u32>,
}

/// A triangle primitive of the mesh as the build's input lays it, and the rank of the height map it
/// is displaced by.
pub(crate) struct Piece<'a> {
    pub material: usize,
    pub positions: &'a [f32],
    pub attributes: &'a [Attribute],
    pub indices: &'a [u32],
}

/// How much finer than the error the build is held to the tessellation goes: the mesh is
/// over-tessellated by half and simplified down.
const OVERTESSELLATION: f32 = 1.5;

/// The kinds of attribute the rows of a soup carry, in the order the primitives first give them,
/// each as wide as the widest gives it: a primitive that has not a kind reads zeros of it (a
/// colour's missing channels white), and gets back only the kinds it brought.
struct Layout(Vec<(u32, usize)>);

impl Layout {
    fn of(pieces: &[Piece<'_>]) -> Self {
        let mut kinds: Vec<(u32, usize)> = Vec::new();
        for attribute in pieces.iter().flat_map(|piece| piece.attributes) {
            match kinds.iter_mut().find(|kind| kind.0 == attribute.flag) {
                Some(kind) => kind.1 = kind.1.max(attribute.width),
                None => kinds.push((attribute.flag, attribute.width)),
            }
        }
        Self(kinds)
    }

    /// The floats of a row, the position's first three included.
    fn stride(&self) -> usize {
        3 + self.0.iter().map(|kind| kind.1).sum::<usize>()
    }

    /// Where the kind `flag` starts in a row, none for a soup that has not the kind.
    fn at(&self, flag: u32) -> Option<usize> {
        let mut at = 3;
        for &(kind, width) in &self.0 {
            if kind == flag {
                return Some(at);
            }
            at += width;
        }
        None
    }
}

/// The vertices the triangles of `piece` name, as rows of `layout` — the position in centimetres,
/// then each kind — in their order; the position of each alone; and each triangle's corners
/// renumbered to them.
fn rows_of(piece: &Piece<'_>, layout: &Layout) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let vertices = piece.positions.len() / 3;
    let mut used = vec![false; vertices];
    for &vertex in piece.indices {
        used[vertex as usize] = true;
    }
    let own: Vec<(Option<&Attribute>, usize, f32)> = (layout.0.iter())
        .map(|&(flag, width)| {
            let attribute = piece.attributes.iter().find(|a| a.flag == flag);
            (attribute, width, if flag == FLAG_COLOR { 1.0 } else { 0.0 })
        })
        .collect();
    let mut renumbered = vec![0; vertices];
    let (mut rows, mut centimetres) = (Vec::new(), Vec::new());
    let mut count = 0;
    for vertex in (0..vertices).filter(|&vertex| used[vertex]) {
        renumbered[vertex] = count;
        count += 1;
        let position = piece.positions[vertex * 3..vertex * 3 + 3]
            .iter()
            .map(|x| x * CENTIMETRES);
        centimetres.extend(position.clone());
        rows.extend(position);
        for &(attribute, width, fill) in &own {
            for k in 0..width {
                let value = attribute.filter(|a| k < a.width);
                rows.push(value.map_or(fill, |a| a.values[vertex * a.width + k]));
            }
        }
    }
    debug_assert_eq!(rows.len(), count as usize * layout.stride());
    let corners = (piece.indices.iter())
        .map(|&vertex| renumbered[vertex as usize])
        .collect();
    (rows, centimetres, corners)
}

/// The meshes `pieces` — their positions (metres), attributes and triangles as the build's input
/// lays them — tessellated as one soup and displaced by the maps of `settings`, the triangles of
/// piece `p` by the map of rank `p.material`, to the error `trimmed_error`, in percent of the
/// mesh's size, the tessellation making at most `cap` triangles. Each piece comes back by itself,
/// in order: its triangles, the vertices they name, the kinds of attribute it brought, blended from
/// the corners a vertex the tessellation adds lies between, as the position is. The vertices at one
/// position take the mean of their displacements whichever piece they belong to, so no crack opens
/// between two.
pub(crate) fn bake_mesh(
    cap: usize,
    settings: &Bake,
    trimmed_error: f32,
    pieces: &[Piece<'_>],
) -> Vec<Baked> {
    let layout = Layout::of(pieces);
    let stride = layout.stride();
    let (mut rows, mut centimetres) = (Vec::new(), Vec::new());
    let (mut corners, mut materials) = (Vec::new(), Vec::new());
    for piece in pieces {
        let (own_rows, own_centimetres, own_corners) = rows_of(piece, &layout);
        let base = (rows.len() / stride) as u32;
        rows.extend(own_rows);
        centimetres.extend(own_centimetres);
        let triangles = own_corners.len() / 3;
        materials.extend(std::iter::repeat_n(piece.material as i32, triangles));
        corners.extend(own_corners.into_iter().map(|corner| corner + base));
    }
    let area = crate::simplify::region::surface_area(&centimetres, &corners);
    let size = crate::dag::relative_size(area, named_bounds(&centimetres, &corners));
    let target = trimmed_error * 0.01 * size * OVERTESSELLATION;
    let displacer = Displacer {
        maps: &settings.maps,
        normal: layout.at(FLAG_NORMAL),
        uv: UV_FLAGS
            .get(settings.uv_channel)
            .and_then(|&flag| layout.at(flag)),
    };
    let uv_sets = UV_FLAGS
        .iter()
        .filter_map(|&flag| layout.at(flag))
        .collect();
    let soup = Soup::new(
        (rows, stride),
        uv_sets,
        (corners, materials),
        settings.edge_split,
    );
    let tessellated = tessellate(soup, &displacer, (target * target, target), cap);
    let (rows, indices, materials) = tessellated.into_parts();
    let soup = (&rows[..], &indices[..], &materials[..]);
    pieces
        .iter()
        .map(|piece| baked_piece(piece, &layout, soup))
        .collect()
}

/// What of a tessellated soup (`rows`, `indices`, `materials`) is `piece`'s: the triangles of its
/// material, the vertices they name renumbered in their order, and the kinds of attribute it brought.
fn baked_piece(
    piece: &Piece<'_>,
    layout: &Layout,
    (rows, indices, materials): (&[f32], &[u32], &[i32]),
) -> Baked {
    let stride = layout.stride();
    let material = piece.material as i32;
    let mine: Vec<usize> = (0..materials.len())
        .filter(|&triangle| materials[triangle] == material)
        .collect();
    let corners = |triangle: usize| &indices[triangle * 3..triangle * 3 + 3];
    let mut named = vec![false; rows.len() / stride];
    for &triangle in &mine {
        for &vertex in corners(triangle) {
            named[vertex as usize] = true;
        }
    }
    let mut renumbered = vec![0; named.len()];
    let mut vertices = Vec::new();
    for vertex in (0..named.len()).filter(|&vertex| named[vertex]) {
        renumbered[vertex] = vertices.len() as u32;
        vertices.push(vertex);
    }
    let mut positions = Vec::with_capacity(vertices.len() * 3);
    for &vertex in &vertices {
        let at = vertex * stride;
        positions.extend(rows[at..at + 3].iter().map(|x| x / CENTIMETRES));
    }
    let attributes = (piece.attributes.iter())
        .map(|attribute| {
            let (width, start) = (attribute.width, layout.at(attribute.flag));
            let start = start.expect("a kind of the piece");
            let mut values = Vec::with_capacity(vertices.len() * width);
            for &vertex in &vertices {
                let at = vertex * stride + start;
                values.extend_from_slice(&rows[at..at + width]);
            }
            Attribute {
                flag: attribute.flag,
                width,
                values,
            }
        })
        .collect();
    let indices = (mine.iter())
        .flat_map(|&triangle| {
            corners(triangle)
                .iter()
                .map(|&vertex| renumbered[vertex as usize])
        })
        .collect();
    Baked {
        positions,
        attributes,
        indices,
    }
}
