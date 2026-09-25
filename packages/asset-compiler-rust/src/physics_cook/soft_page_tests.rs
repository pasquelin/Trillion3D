//! The cook's soft records against the page's: `soft_record.rs` mirrors `softBodyOf`
//! (`packages/sdk-core/src/physics/soft.ts`), and both read the same golden records. This test
//! writes them from the cook; `softCook.test.ts` rebuilds each on the page and requires the same
//! vertices, masses and corners bit for bit, and the same pressure.
use super::soft_record::{soft_record, SoftDeclared, SoftRecord};
use super::soft_tests::{declared, golden_record};
use super::tests::assert_golden;

const RECORDS: &str = "../../tests/fixtures/physics/soft-records.bin";

/// A record as the fixture lays it, little-endian: `u32` word count, `f32` words (`x, y, z,
/// mass` per vertex), `u32` corner count, `u32` corners, `f64` pressure.
fn record_bytes(r: &SoftRecord) -> Vec<u8> {
    let mut out = (r.vertices.len() as u32).to_le_bytes().to_vec();
    out.extend(r.vertices.iter().flat_map(|v| v.to_le_bytes()));
    out.extend((r.indices.len() as u32).to_le_bytes());
    out.extend(r.indices.iter().flat_map(|i| i.to_le_bytes()));
    out.extend(r.pressure.to_le_bytes());
    out
}

// Behaviour: the cook weighs, welds, pins and pressurises three soft bodies — the golden cloth
// pinned at its top corners; a rope along x whose middle point is written twice (a seam), scaled
// 2 × 1 × 3 and given 0.3 kg, its hook held; a closed tetrahedron with its default pressure — into
// the golden records the page's test rebuilds with `softBodyOf`.
#[test]
fn the_cooks_soft_records_are_the_golden_ones_the_page_rebuilds() {
    let seam = [0.0f32, 0., 0., 1., 0., 0., 1., 0., 0., 2., 0.5, 0.];
    let tetra = [0.0f32, 0., 0., 1., 0., 0., 0., 1., 0., 0., 0., 1.];
    let faces = [0u32, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
    let rope = SoftDeclared {
        mass: Some(0.3),
        ..declared("rope", &[0.0])
    };
    let volume = SoftDeclared {
        bend: f64::INFINITY,
        ..declared("volume", &[])
    };
    let records = [
        golden_record(),
        soft_record(&seam, None, [2.0, 1.0, 3.0], &rope).unwrap(),
        soft_record(&tetra, Some(&faces), [1.0; 3], &volume).unwrap(),
    ];
    let bytes: Vec<u8> = records.iter().flat_map(record_bytes).collect();
    assert!(records[2].pressure > 0.0, "the volume holds gas");
    assert_golden(&bytes, RECORDS);
}
