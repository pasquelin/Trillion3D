use super::*;

// Comportement 3 (a) : une image dont aucun côté ne dépasse la base est portée telle quelle. Sa
// case de réduction vaut exactement un texel source, donc le premier niveau est la pleine
// résolution sans perte, et le moteur n'a plus rien à charger pour cette texture.
#[test]
fn a_source_under_the_base_carries_its_own_full_resolution() {
    let (width, height) = (4u32, 4u32);
    let source = rgba_from(width, height, |x, y| {
        [(x * 60) as u8, (y * 60) as u8, 10, 255]
    });
    let (first, pixels) = reduce::pyramid(&source, Transfer::Srgb, None);
    assert_eq!(first, 0);
    assert_eq!(level_size(width, height, 0), (4, 4));
    let level0 = level_bytes(width, height, &pixels, 0);
    for row in 0..height as usize {
        for column in 0..width as usize {
            let at = (row * width as usize + column) * 4;
            let expected = source.get_pixel(column as u32, row as u32);
            assert_eq!(level0[at], expected[0], "rouge en ({row},{column})");
            assert_eq!(level0[at + 1], expected[1], "vert en ({row},{column})");
            assert_eq!(level0[at + 3], 255);
        }
    }
}

// Comportement 3 (b) : des dimensions impaires et dissemblables (17×9) ne font pas planter la
// réduction, une couleur uniforme y survit exactement à chaque niveau, et la longueur écrite est
// exactement celle que la géométrie annonce.
#[test]
fn odd_dimensions_reduce_without_panicking() {
    let (width, height) = (17u32, 9u32);
    let source = rgba_from(width, height, |_x, _y| [37, 201, 88, 255]);
    let (first, pixels) = reduce::pyramid(&source, Transfer::Srgb, None);
    assert_eq!(first, 0);
    assert_eq!(pixels.len(), preview_pixel_bytes(width, height));
    assert_eq!(preview_level_count(width, height), 5);
    for index in 0..preview_level_count(width, height) as usize {
        for texel in level_bytes(width, height, &pixels, index).chunks(4) {
            assert_eq!(texel, [37, 201, 88, 255], "niveau {index} uniforme");
        }
    }
}
