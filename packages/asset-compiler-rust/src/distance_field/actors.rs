//! The distance field of an HLOD cell's actors: the level-0 triangles of the meshes the cell's
//! layer built, in the world's space, read as one mesh — the reference builds the field of an HLOD
//! mesh from the merged mesh as it builds a source mesh's, its sections together — and stored for
//! the cell (`Owner::HlodCell`), which the runtime places where the world DAG is.
use super::brick::{Brick, BRICK_VOXELS};
use super::build::build;
use super::encode::{Owner, Placed};
use super::grid::most_bricks;
use super::scene::Scene;
use super::DistanceFieldSettings;
use std::mem::size_of;
use trillion3d_page_codec::proxy::{bvh::Node, PROXY_LEAF_TRIANGLES};

/// One actor's mesh, as its cell's field reads it.
pub(crate) struct ActorTriangles<'a> {
    /// Its vertices' positions, metres, three each.
    pub positions: &'a [f32],
    /// Its triangles' corners, three each.
    pub indices: &'a [u32],
    /// Whether the material it wears draws both faces.
    pub two_sided: bool,
    /// Whether it wears a blended material: its triangles are left out of the field, as a source
    /// mesh's are.
    pub blended: bool,
}

/// The bytes a triangle holds while a cell's field is built: its corners (nine floats) three times —
/// the cell's list, the scene's soup and the tree's order —, its place in that order and among the
/// triangles kept, its side's flag twice, and its share of the tree's nodes.
const FIELD_TRIANGLE_BYTES: usize = 3 * size_of::<[f32; 9]>()
    + 2 * size_of::<usize>()
    + 2 * size_of::<bool>()
    + size_of::<Node>() * 2 / PROXY_LEAF_TRIANGLES;

/// The bytes a cell of the field's volume holds while it is measured: the voxels of its brick, the
/// brick as measured and its word of the indirection table.
const FIELD_CELL_BYTES: usize = BRICK_VOXELS + size_of::<Brick>() + size_of::<u32>();

/// The bytes the scene a cell's field or its cards are cast against holds, `triangles` triangles of
/// it (`FIELD_TRIANGLE_BYTES` each): the soup, the tree and the lists.
pub(crate) fn scene_bytes(triangles: usize) -> usize {
    triangles.saturating_mul(FIELD_TRIANGLE_BYTES)
}

/// The bytes the field of a cell of `triangles` triangles holds while `actors_field` builds it as
/// `settings` say, beside what the cell's actors hold: its triangles' copies and their tree, and
/// the bricks of every cell of its volume, which a mip measures all at once — at most the cells the
/// resolution allows (`most_bricks`), the mips below holding an eighth of the one above each. None
/// where they ask for none.
pub(crate) fn field_bytes(triangles: usize, settings: &DistanceFieldSettings) -> usize {
    if !settings.builds() {
        return 0;
    }
    let cells = most_bricks(settings).saturating_pow(3).saturating_mul(2);
    scene_bytes(triangles).saturating_add(cells.saturating_mul(FIELD_CELL_BYTES))
}

/// The scene of the actors `parts` read as one mesh, every triangle two-sided when `as_if_two_sided`
/// asks; the triangles of a part wearing a blended material are queried only when `blended` keeps
/// them, as the mesh cards' build does and a field's does not. None when no triangle is left to
/// query.
pub(crate) fn actors_scene(
    parts: &[ActorTriangles<'_>],
    as_if_two_sided: bool,
    blended: bool,
) -> Option<Scene> {
    let count: usize = parts.iter().map(|part| part.indices.len() / 3).sum();
    let mut triangles: Vec<f32> = Vec::with_capacity(count * 9);
    let (mut flags, mut kept) = (Vec::with_capacity(count), Vec::with_capacity(count));
    for part in parts {
        for corners in part.indices.as_chunks::<3>().0 {
            if blended || !part.blended {
                kept.push(flags.len());
            }
            flags.push(part.two_sided || as_if_two_sided);
            for &vertex in corners {
                let at = vertex as usize * 3;
                triangles.extend_from_slice(&part.positions[at..at + 3]);
            }
        }
    }
    Scene::of_triangles(&triangles, flags, &kept, as_if_two_sided)
}

/// The field of the actors `parts` of HLOD cell `cell`, built as `settings` say: none when they ask
/// for none, or when no triangle is left to query.
pub(crate) fn actors_field(
    cell: usize,
    parts: &[ActorTriangles<'_>],
    settings: &DistanceFieldSettings,
) -> Option<Placed> {
    if !settings.builds() {
        return None;
    }
    let scene = actors_scene(parts, settings.as_if_two_sided, false)?;
    // A cell's field is built with the world's actors, which take no cancel token: never raised.
    let never = std::sync::atomic::AtomicBool::new(false);
    Some(Placed {
        owner: Owner::HlodCell(cell as u32),
        field: build(&scene, settings, &never).expect("a token never raised refuses nothing"),
    })
}

#[cfg(test)]
mod tests {
    use super::super::abi::{DISTANCE_FIELD_FLAG_HLOD_CELL, DISTANCE_FIELD_FLAG_TWO_SIDED};
    use super::super::encode::{encode, report, Owner};
    use super::*;

    /// A cube of `side` metres whose low corner is `origin`: its eight corners, x fastest, and its
    /// twelve triangles.
    fn cube(origin: [f32; 3], side: f32) -> (Vec<f32>, Vec<u32>) {
        let positions = (0..8u32)
            .flat_map(|c| [0, 1, 2].map(|k| origin[k] + side * ((c >> k) & 1) as f32))
            .collect();
        let indices = (crate::distance_field::BOX_FACES.iter())
            .flat_map(|&[a, b, c, d]| [a, b, c, a, c, d].map(|corner| corner as u32))
            .collect();
        (positions, indices)
    }

    /// The record of the one field `placed`, as the file lays it: its first word, its flags and
    /// the low corner of its box, metres.
    fn record(placed: &Placed) -> (u32, u32, [f32; 3]) {
        let file = encode(std::slice::from_ref(placed));
        let word = |at: usize| u32::from_le_bytes(file[at..at + 4].try_into().expect("a word"));
        let head = super::super::abi::DISTANCE_FIELD_HEAD_BYTES;
        let low = [8, 12, 16].map(|k| f32::from_bits(word(head + k)));
        (word(head), word(head + 4), low)
    }

    #[test]
    fn a_cells_actors_are_one_field_in_the_worlds_space_named_for_their_cell() {
        let (positions, indices) = cube([100.0, 0.0, 0.0], 2.0);
        let part = |two_sided, blended| ActorTriangles {
            positions: &positions,
            indices: &indices,
            two_sided,
            blended,
        };
        let settings = DistanceFieldSettings::default();
        let placed = actors_field(7, &[part(false, false)], &settings).expect("a field");
        assert_eq!(placed.owner, Owner::HlodCell(7));
        // The cell is the record's first word, flagged as an HLOD cell's; the box lies where the
        // world's triangles do, not about the origin.
        let (cell, flags, low) = record(&placed);
        assert_eq!((cell, flags), (7, DISTANCE_FIELD_FLAG_HLOD_CELL));
        assert!((low[0] - 100.0).abs() < 0.01, "{low:?}");
        let section = report(&[placed], 0);
        assert_eq!(section["meshes"][0]["mesh"], 7);
        assert_eq!(section["meshes"][0]["hlodCell"], true);
        // Two-sided faces say so beside the cell.
        let sided = actors_field(7, &[part(true, false)], &settings).expect("a field");
        let two_sided = DISTANCE_FIELD_FLAG_HLOD_CELL | DISTANCE_FIELD_FLAG_TWO_SIDED;
        assert_eq!(record(&sided).1, two_sided);
    }

    // Behaviour: a scene that builds every triangle as two-sided builds a cell's so, whatever the
    // material its actor wears: the rays leave no triangle's back face to count as inside.
    #[test]
    fn a_scene_that_asks_for_two_sided_builds_every_triangle_of_a_cell_so() {
        let (positions, indices) = cube([0.0; 3], 2.0);
        let part = |two_sided| ActorTriangles {
            positions: &positions,
            indices: &indices,
            two_sided,
            blended: false,
        };
        let voxels = |two_sided, as_if_two_sided| {
            let settings = DistanceFieldSettings {
                as_if_two_sided,
                ..DistanceFieldSettings::default()
            };
            let placed = actors_field(1, &[part(two_sided)], &settings).expect("a field");
            let mips = placed.field.mips;
            mips.into_iter().map(|mip| mip.voxels).collect::<Vec<_>>()
        };
        assert_eq!(
            voxels(false, true),
            voxels(true, true),
            "the scene's word is the triangles'"
        );
        assert_ne!(
            voxels(false, false),
            voxels(true, false),
            "else the material's is"
        );
    }

    // Behaviour: a cell's field is charged while it is built, its triangles' copies and its volume's
    // bricks, none where the scene builds none, and no more volume than the resolution allows.
    #[test]
    fn a_cells_field_is_charged_by_its_triangles_and_the_volume_the_resolution_allows() {
        let settings = DistanceFieldSettings::default();
        let some = field_bytes(1_000, &settings);
        assert!(some >= 1_000 * FIELD_TRIANGLE_BYTES);
        assert!(field_bytes(2_000, &settings) > some);
        let off = DistanceFieldSettings {
            generate: false,
            ..settings
        };
        assert_eq!(field_bytes(1_000, &off), 0);
        let fine = DistanceFieldSettings {
            max_resolution: settings.max_resolution * 2,
            ..settings
        };
        assert!(field_bytes(0, &fine) > field_bytes(0, &settings));
    }

    #[test]
    fn a_cells_field_is_left_out_when_nothing_is_left_to_query_or_the_scene_asks_for_none() {
        let (positions, indices) = cube([0.0; 3], 1.0);
        let blended = ActorTriangles {
            positions: &positions,
            indices: &indices,
            two_sided: false,
            blended: true,
        };
        let settings = DistanceFieldSettings::default();
        assert!(
            actors_field(1, &[blended], &settings).is_none(),
            "only blended triangles"
        );
        assert!(actors_field(1, &[], &settings).is_none(), "no triangle");
        let off = DistanceFieldSettings {
            generate: false,
            ..settings
        };
        let opaque = ActorTriangles {
            blended: false,
            positions: &positions,
            indices: &indices,
            two_sided: false,
        };
        assert!(
            actors_field(1, &[opaque], &off).is_none(),
            "the scene builds none"
        );
    }
}
