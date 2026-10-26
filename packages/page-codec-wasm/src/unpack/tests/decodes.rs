//! The sequential reader against the reference decoder: page shapes, random pages and their corruptions, edge cases.

use super::*;

#[test]
fn the_audits_page_shapes_decode_to_the_same_words() {
    let mut rng = Rng(12345);
    let shapes = [
        (9, 3),
        (24, 3),
        (64, 3),
        (72, 1),
        (64, ALL),
        (181, 3),
        (128, 0),
    ];
    for (side, flags) in shapes {
        let mut indices = Vec::new();
        for y in 0..side - 1 {
            for a in (y * side..).take(side - 1).map(|a| a as u32) {
                let (b, c) = (a + 1, a + side as u32);
                indices.extend([a, c, b, b, c, c + 1]);
            }
        }
        assert!(same(&page(&mut rng, side * side, &indices, flags, false)).is_ok());
    }
}

#[test]
fn ten_thousand_random_pages_and_their_corruptions_decode_the_same() {
    let (mut rng, mut refused) = (Rng(GOLDEN_32), [0; 6]);
    for i in 0..10_000 {
        let n = 1 + rng.below(if i % 50 == 0 { 65_535 } else { 400 }) as usize;
        let triangles = 1 + rng.below(300) as usize;
        let indices = corners(&mut rng, n, triangles);
        let flags = attributes(&mut rng);
        let mut data = page(&mut rng, n, &indices, flags, false);
        if i % 4 == 3 {
            let at = rng.below(data.len() as u32) as usize;
            data[at] ^= 1 << rng.below(8);
        }
        if let Err(cause) = same(&data) {
            refused[cause as usize] += 1;
        }
    }
    // The corruptions reach both late refusals, the block table and a corner out of range.
    assert!(refused[PageError::Bounds as usize] > 0 && refused[PageError::Index as usize] > 0);
}

#[test]
fn the_edge_cases_decode_the_same() {
    let mut rng = Rng(7);
    // The smallest page, then no triangle and no byte: refused alike.
    assert!(same(&page(&mut rng, 1, &[0, 0, 0], 0, false)).is_ok());
    assert_eq!(
        same(&page(&mut rng, 1, &[], 0, false)),
        Err(PageError::Bounds)
    );
    assert_eq!(same(&[]), Err(PageError::Header));
    // Every field at its widest, on the finest grid and the farthest cells, and 65,535 vertices:
    // 16-bit corners, and fields crossing words at every offset.
    let widest: Vec<u32> = (0..65_535).chain([65_534, 0, 1]).collect();
    assert!(same(&page(&mut rng, 65_535, &widest, ALL, true)).is_ok());
    // A stream ending exactly on a word, then one bit past it.
    for n in [32, 33] {
        assert_eq!((n * MAX_BITS as usize).is_multiple_of(32), n == 32);
        let indices = corners(&mut rng, n, 40);
        assert!(same(&page(&mut rng, n, &indices, ALL, true)).is_ok());
    }
    // A precision past the format's, finer or coarser, never decodes: both decoders refuse the header.
    for forged in [
        (MAX_POSITION_PRECISION + 1) as i8,
        (MIN_POSITION_PRECISION - 1) as i8,
    ] {
        let mut data = page(&mut rng, 3, &[0, 1, 2], 0, false);
        data[23] = forged as u8;
        assert_eq!(same(&data), Err(PageError::Bounds));
    }
}
