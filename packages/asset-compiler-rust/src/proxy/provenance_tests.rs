use crate::proxy::assemble::{assemble, assemble_owned};

fn identity() -> [f64; 16] {
    [
        1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
    ]
}

#[test]
fn coincident_owners_survive_without_changing_static_geometry() {
    let triangle = [0., 0., 0., 1., 0., 0., 0., 1., 0.];
    let triangles: Vec<f32> = triangle.repeat(2);
    let colours = vec![0xff00_00ff, 0xff00_ff00];
    let original = assemble(&[], triangles.clone(), colours.clone());
    let owned = assemble_owned(&[], triangles, colours, &[0, 1], &[identity(), identity()]);
    assert_eq!(
        original
            .triangles
            .iter()
            .map(|v| v.to_bits())
            .collect::<Vec<_>>(),
        owned
            .triangles
            .iter()
            .map(|v| v.to_bits())
            .collect::<Vec<_>>()
    );
    assert_eq!(original.albedo, owned.albedo);
    assert_eq!(original.node_bounds, owned.node_bounds);
    assert_eq!(original.node_children, owned.node_children);
    assert_eq!(owned.provenance.group_offsets, [0, 2]);
    assert_eq!(owned.provenance.owners, [0, 0xff00_00ff, 1, 0xff00_ff00]);
    assert!(owned
        .provenance
        .triangle_groups
        .iter()
        .all(|group| *group == 0));
    assert!(
        owned.triangle_count() > 1,
        "subdivision must preserve the shared group"
    );
}

#[test]
fn reordered_cells_keep_the_owner_that_supplied_their_colour() {
    let mut triangles = Vec::new();
    for x in [8., 0., 4., 12.] {
        triangles.extend([x, 0., 0., x + 1., 0., 0., x, 1., 0.]);
    }
    let proxy = assemble_owned(
        &[],
        triangles,
        vec![11, 22, 33, 44],
        &[0, 1, 2, 3],
        &[identity(); 4],
    );
    for (triangle, group) in proxy.provenance.triangle_groups.iter().enumerate() {
        let owner = proxy.provenance.group_offsets[*group as usize] as usize;
        assert_eq!(
            proxy.albedo[triangle],
            proxy.provenance.owners[owner * 2 + 1]
        );
    }
}

#[test]
fn repeated_cells_intern_the_same_source_group() {
    let mut triangles = Vec::new();
    for x in [0., 4., 8.] {
        triangles.extend([x, 0., 0., x + 1., 0., 0., x, 1., 0.]);
    }
    let proxy = assemble_owned(&[], triangles, vec![5; 3], &[0; 3], &[identity()]);
    assert_eq!(proxy.provenance.group_offsets, [0, 1]);
    assert_eq!(proxy.provenance.owners, [0, 5]);
    let bytes = proxy.encode();
    let expected = 44 + proxy.triangle_count() * 44 + proxy.node_count() * 72 + 8 + 8 + 4 + 4 + 128;
    assert_eq!(
        bytes.len(),
        expected,
        "all version-five suffix lengths are explicit"
    );
}

#[test]
fn static_triangle_columns_match_the_literal_version_two_fixture() {
    let proxy = assemble_owned(
        &[],
        vec![0., 0., 0., 0.5, 0., 0., 0., 0.5, 0.],
        vec![0xff00_00ff],
        &[0],
        &[identity()],
    );
    // A half-metre right triangle subdivides at n=2; the single leaf keeps emission order.
    assert_eq!(
        proxy.triangles,
        [
            0., 0., 0., 0.25, 0., 0., 0., 0.25, 0., 0.25, 0., 0., 0.25, 0.25, 0., 0., 0.25, 0., 0.,
            0.25, 0., 0.25, 0.25, 0., 0., 0.5, 0., 0.25, 0., 0., 0.5, 0., 0., 0.25, 0.25, 0.,
        ]
    );
    assert_eq!(proxy.albedo, [0xff00_00ff; 4]);
    assert_eq!(proxy.node_bounds, [0., 0., 0., 0.5, 0.5, 0.]);
    assert_eq!(
        proxy.node_children,
        [0xff00_0000, 0x0104_ffff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    );
}
