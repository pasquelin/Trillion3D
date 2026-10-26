//! The page on disk: its strips unpack to their triangles, it reads back its values and decodes as the resident page.

use super::*;

#[test]
fn the_strips_unpack_to_the_triangles_they_were_laid_from() {
    let mut rng = Rng(0x57A1);
    for i in 0..3_000 {
        let n = 1 + rng.below(300) as usize;
        let triangles = 1 + rng.below(MAX_PAGE_TRIANGLES as u32) as usize;
        let indices = corners(&mut rng, n, triangles);
        let strips = strips_in_order(&indices);
        // Each laid index names the vertex it was laid for, so the triangles are the list's, in
        // its order, each turned to the corner its strip lays it from.
        assert_eq!(strips.triangles.len(), indices.len(), "list {i}");
        for (t, laid) in strips.triangles.chunks(3).enumerate() {
            let named: Vec<u32> = laid.iter().map(|&l| strips.laid[l as usize]).collect();
            let mut given = indices[t * 3..t * 3 + 3].to_vec();
            let mut turned = named.clone();
            given.sort_unstable();
            turned.sort_unstable();
            assert_eq!(turned, given, "triangle {t} of list {i}");
        }
    }
}

#[test]
fn a_page_on_disk_reads_back_the_values_it_was_written_from() {
    let mut rng = Rng(0xD15C);
    for i in 0..3_000 {
        let n = 1 + rng.below(MAX_PAGE_VERTICES as u32) as usize;
        let triangles = 1 + rng.below(MAX_PAGE_TRIANGLES as u32) as usize;
        let flags = attributes(&mut rng);
        let page = values(&mut rng, n, triangles, flags, i % 7 == 0);
        let bytes = disk::write(&page, &crate::refs::Refs::none(page.header.vertex_count));
        assert_eq!(read_whole(&bytes), Ok(page.clone()), "page {i}");
        let named = alone(&page);
        assert_eq!(
            read_whole(&named),
            Ok(page),
            "page {i} naming its own vertices"
        );
    }
}

fn read_whole(bytes: &[u8]) -> Result<Page, PageError> {
    disk::read(bytes, 1 << 24, &[])
}

#[test]
fn a_page_naming_another_clusters_vertices_finds_them_in_its_resident_page() {
    // Two triangles of a square, each a cluster: the second shares two vertices with the first,
    // which its page names in the first's resident page.
    let positions: Vec<f32> = [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
    ]
    .concat();
    let first = encode(&[0, 1, 2], &positions, &[], GRID).expect("a cluster");
    let second = encode(&[0, 2, 3], &positions, &[], GRID).expect("another");
    let resident = resident::expand(&first.bytes, 1 << 24, &[]).expect("resident");
    let shelf = Shelf::of(vec![(0, &first.bytes[..])]).expect("a shelf");
    let parents = [Parent {
        rank: 1,
        shelf: &shelf,
    }];
    let shared = share(&second.bytes, 0, &parents, &mut Same::default()).expect("shared");
    let page = disk::read_raw(&shared, 1 << 24).expect("gated alone");
    assert_eq!(page.refs.pairs, vec![pair(1, 0)]);
    assert_eq!(page.refs.entries.len(), 2);
    // Without the cluster it names, the page is not whole; with it, it is the page it was.
    assert_eq!(disk::read(&shared, 1 << 24, &[]), Err(PageError::Refs));
    let found = disk::read(&shared, 1 << 24, &[&resident[..]]).expect("found");
    let whole = disk::read(&second.bytes, 1 << 24, &[]).expect("whole");
    assert_eq!(found, whole);
}

#[test]
fn a_page_on_disk_decodes_as_the_resident_page_it_expands_to() {
    let mut rng = Rng(0xE0F0);
    for i in 0..2_000 {
        let n = 1 + rng.below(MAX_PAGE_VERTICES as u32) as usize;
        let triangles = 1 + rng.below(MAX_PAGE_TRIANGLES as u32) as usize;
        let flags = attributes(&mut rng);
        let page = values(&mut rng, n, triangles, flags, i % 5 == 0);
        let mut bytes = alone(&page);
        // One page in three is corrupted at a byte: a refusal, or the very page its bytes spell.
        if i % 3 == 2 {
            let at = rng.below(bytes.len() as u32) as usize;
            bytes[at] ^= 1 << rng.below(8);
        }
        match resident::expand(&bytes, 1 << 24, &[]) {
            Ok(resident) => {
                let parsed = Header::parse(&bytes, 1 << 24).expect("a page that expands parses");
                assert_eq!(resident.len(), parsed.resident_bytes());
                assert_eq!(Header::parse_resident(&resident, 1 << 24), Ok(parsed));
                let decoded = decode(&bytes, 1 << 24).map(|page| page.words);
                assert_eq!(decoded, reference(&resident, 1 << 24), "page {i}");
            }
            Err(refusal) => assert_eq!(decode(&bytes, 1 << 24).unwrap_err(), refusal),
        }
    }
}

#[test]
fn a_page_on_disk_the_format_does_not_allow_is_refused() {
    let mut rng = Rng(5);
    let page = values(&mut rng, 3, 1, 0, false);
    let good = alone(&page);
    assert!(read_whole(&good).is_ok());
    // Another version, a length that is not the counts', a section named elsewhere.
    for alter in [
        |b: &mut Vec<u8>| b[4] = 9,
        |b: &mut Vec<u8>| b.push(0),
        |b: &mut Vec<u8>| b[crate::HEADER_BYTES + 16] ^= 4,
        |b: &mut Vec<u8>| b.truncate(b.len() - 4),
    ] {
        let mut bytes = good.clone();
        alter(&mut bytes);
        assert!(read_whole(&bytes).is_err());
    }
    // A strip that names a vertex past the page's: the first triangle's third corner, forged.
    let mut forged = page.clone();
    forged.strip.masks[0][0] = 1;
    forged.strip.masks[0][2] = 1;
    assert!(read_whole(&alone(&forged)).is_err());
    // A page past the corners an install transcodes.
    let mut huge = page;
    huge.header.index_count = 3 * (MAX_PAGE_TRIANGLES + 1);
    assert_eq!(read_whole(&alone(&huge)).unwrap_err(), PageError::Bounds);
}
