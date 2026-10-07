//! The certified screen error to the bits, on the table its JavaScript counterpart reads too
//! (`packages/sdk-core/src/lod/screenErrorBits.json`, `screenErrorBits.test.ts`): a drift on
//! either side fails the side that moved.
use super::*;

const TABLE: &str = include_str!("../../sdk-core/src/lod/screenErrorBits.json");

/// The table's rows: the quoted strings past `"rows"`.
fn rows() -> Vec<&'static str> {
    let (_, list) = TABLE.split_once("\"rows\"").expect("a rows list");
    list.split('"').skip(1).step_by(2).collect()
}

#[test]
fn the_screen_error_of_every_table_row_has_the_bits_the_table_pins() {
    let rows = rows();
    assert!(!rows.is_empty());
    for row in rows {
        let (operands, expected) = row.split_once(" : ").expect("operands, then the pixels");
        // Decimal as JavaScript writes it, `inf` and `nan` included: `parse` reads both.
        let v: Vec<f64> = operands.split(' ').map(|w| w.parse().unwrap()).collect();
        assert_eq!(v.len(), 8, "{row}");
        let lens = Lens {
            view: [0.0; 16],
            stretch: v[1],
            focal: v[5],
            near: v[6],
            perspective: v[7],
        };
        let got = match projected_error_at(v[0], v[2], v[3], v[4], &lens) {
            Ok(pixels) => format!("{:016x}", pixels.to_bits()),
            Err(Invalid) => "invalid".to_string(),
        };
        assert_eq!(got, expected, "{row}");
    }
}
