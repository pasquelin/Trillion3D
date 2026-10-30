//! The world's trees cut every actor at its own error into a record of its own, naming its cell
//! and wearing its flags and material rank; the directory has an entry for each, standing where a triangle does;
//! a cluster no gate names holds none.
use super::cluster;
use crate::ray_tracing::abi::*;
use crate::ray_tracing::encode::encode;
use crate::ray_tracing::world::{world_trees, WorldGate};
use crate::support::le::u32_at;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_UV, FLAG_UV1};

/// The cluster rank of each triangle of `bytes`, sorted.
fn clusters_of(bytes: &[u8]) -> Vec<u32> {
    let mut found: Vec<u32> = (bytes.chunks(RAY_TRACING_TRIANGLE_BYTES))
        .map(|t| u32_at(t, 36).unwrap())
        .collect();
    found.sort_unstable();
    found
}

#[test]
fn every_actor_is_cut_at_its_own_error_into_a_record_naming_its_cell() {
    let infinite = f64::INFINITY;
    // Two squares on one vertex buffer: a unit one at the origin (actor 0, vertices 0 to 3) and a
    // hundred metres wide one far away (actor 1, vertices 4 to 7).
    let mut positions = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
    for (x, y) in [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)] {
        positions.extend([1000.0 + x, y, 0.0]);
    }
    let dag = [
        // Actor 0: its finest cluster is in its cut (its error is 1.4 centimetres), its root is not.
        cluster(vec![0, 1, 2, 0, 2, 3], (0.0, 1.0), false),
        cluster(vec![0, 1, 3], (1.0, infinite), true),
        // Actor 1: 1.4 metres is over the error of its finest cluster's group, so its root stands.
        cluster(vec![4, 5, 6, 4, 6, 7], (0.0, 1.0), false),
        cluster(vec![4, 5, 7], (1.0, infinite), true),
        // A voxel page, whose triangle names the corners of a box: no gate, no triangle.
        cluster(vec![0, 1, 2], (0.0, infinite), false),
    ];
    let flags = [RAY_TRACING_FLAG_TWO_SIDED, RAY_TRACING_FLAG_TRANSLUCENT];
    let cells = [7, 9];
    let gate = |actor: usize| WorldGate {
        actor,
        cell: cells[actor],
        flags: flags[actor],
    };
    let gates = [
        Some(gate(0)),
        Some(gate(0)),
        Some(gate(1)),
        Some(gate(1)),
        None,
    ];
    let trees = world_trees((&positions, &[]), &dag, &gates)
        .expect("trees")
        .expect("triangles");
    assert_eq!(trees.actors.len(), 2);
    // Each actor's cut, by the rank of its clusters: the finest of the first, the root of the second.
    assert_eq!(clusters_of(&trees.actors[0].triangles), [0, 0]);
    assert_eq!(clusters_of(&trees.actors[1].triangles), [3]);
    assert!((trees.actors[0].error - 0.01414).abs() < 1e-4);
    assert!((trees.actors[1].error - 1.4142).abs() < 1e-3);
    // The directory has an entry for each actor: its box, its rank among them and its cell.
    let directory = &trees.directory;
    assert_eq!(directory.triangle_count(), 2);
    let entry = |bytes: &[u8], at: usize| -> Vec<u32> {
        (0..12)
            .map(|k| u32_at(bytes, at * 48 + 4 * k).unwrap())
            .collect()
    };
    let mut entries: Vec<Vec<u32>> = (0..2).map(|k| entry(&directory.triangles, k)).collect();
    entries.sort_by_key(|words| words[9]);
    for (rank, words) in entries.iter().enumerate() {
        let actor = &trees.actors[rank];
        let boxed: Vec<u32> = actor
            .low
            .into_iter()
            .chain(actor.high)
            .map(f32::to_bits)
            .collect();
        assert_eq!(words[..6], boxed[..], "the actor's box");
        assert_eq!(words[6..9], words[0..3], "the low corner again");
        assert_eq!(
            (words[9], words[10], words[11]),
            (rank as u32, 0, cells[rank] as u32)
        );
    }
    // The file lays the actors' records, then the directory: no primitive, the actors' flags, their cell.
    let bytes = encode(&trees.in_file_order().collect::<Vec<_>>()).expect("a file");
    let record = |rank: usize| RAY_TRACING_HEAD_BYTES + rank * RAY_TRACING_RECORD_BYTES;
    let word = |rank: usize, at: usize| u32_at(&bytes, record(rank) + 4 * at).unwrap();
    for (rank, actor_flags) in flags.into_iter().enumerate() {
        // No mesh, the rank of the material the actor wears where a primitive's number is.
        assert_eq!(
            [word(rank, 0), word(rank, 1)],
            [RAY_TRACING_NO_PRIMITIVE, rank as u32]
        );
        // An actor is a mesh of one material: a translucent one is translucent whole.
        let whole = actor_flags & RAY_TRACING_FLAG_TRANSLUCENT != 0;
        assert_eq!(
            word(rank, 2),
            RAY_TRACING_FLAG_ACTOR
                | actor_flags
                | RAY_TRACING_FLAG_ALL_TRANSLUCENT * u32::from(whole)
        );
        assert_eq!(word(rank, 14), cells[rank] as u32);
    }
    assert_eq!([word(2, 0), word(2, 1)], [RAY_TRACING_NO_PRIMITIVE; 2]);
    assert_eq!((word(2, 2), word(2, 14)), (RAY_TRACING_FLAG_WORLD, 0));
}

#[test]
fn a_world_of_voxel_pages_alone_has_no_trees() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0];
    let dag = [cluster(vec![0, 1, 2], (0.0, f64::INFINITY), false)];
    assert!(world_trees((&positions, &[]), &dag, &[None])
        .unwrap()
        .is_none());
}

#[test]
fn an_actor_whose_mask_reads_a_later_set_keeps_the_corners_attributes_and_that_sets_coordinates() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let dag = [cluster(vec![0, 1, 2], (0.0, f64::INFINITY), false)];
    let uvs = Attribute {
        flag: FLAG_UV,
        width: 2,
        values: vec![0.0, 0.0, 2.0, 0.0, 0.0, 3.0],
    };
    let second = Attribute {
        flag: FLAG_UV1,
        width: 2,
        values: vec![5.0, 5.0, 6.0, 5.0, 5.0, 7.0],
    };
    let carried = [&uvs, &second];
    let set = 1 << RAY_TRACING_FLAG_MASK_SET_SHIFT;
    let gate = |flags| {
        Some(WorldGate {
            actor: 4,
            cell: 2,
            flags,
        })
    };
    let masked = world_trees(
        (&positions, &carried),
        &dag,
        &[gate(RAY_TRACING_FLAG_MASKED | set)],
    )
    .expect("trees")
    .expect("triangles");
    let actor = &masked.actors[0];
    assert_eq!(actor.attributes.len(), 3 * RAY_TRACING_CORNER_BYTES);
    assert_eq!(actor.mask.len(), 3 * RAY_TRACING_MASK_CORNER_BYTES);
    let flags = actor.traced.flags;
    assert_eq!(flags & RAY_TRACING_FLAG_MASK_SET, set);
    assert_ne!(flags & RAY_TRACING_FLAG_ATTRIBUTES, 0);
    assert_eq!(actor.traced.primitive, 4, "the rank of its material");
    // A set the world does not carry is left out of the record, whose mask reads the first.
    let only_first = [&uvs];
    let absent = world_trees(
        (&positions, &only_first),
        &dag,
        &[gate(RAY_TRACING_FLAG_MASKED | set)],
    )
    .expect("trees")
    .expect("triangles");
    assert!(absent.actors[0].mask.is_empty());
    assert_eq!(absent.actors[0].traced.flags & RAY_TRACING_FLAG_MASK_SET, 0);
}
