//! Exact measurements survive the sheet; invalid cache data never changes human answers.
use super::*;
use crate::cutout::cache::{algorithm, checksum, record};

fn image() -> image::RgbaImage {
    image::RgbaImage::from_fn(7, 3, |x, y| {
        image::Rgba([
            20,
            80,
            160,
            if x < 2 {
                0
            } else if y == 1 {
                125
            } else {
                255
            },
        ])
    })
}

fn cached(shape: &AlphaShape) -> Value {
    json!({"version":SHEET_VERSION,"measurementAlgorithm":algorithm(),
        "textures":{"image-a":{"cutout":true,"measurement":record("image-a", shape)}}})
}

fn bits(shape: &AlphaShape) -> [u32; 4] {
    [shape.absent, shape.present, shape.between, shape.at_contour].map(f32::to_bits)
}

#[test]
fn exact_measurements_round_trip_without_display_rounding_or_changed_answers() {
    let image = image();
    let measured = measure(&image);
    let sheet = cached(&measured);
    let bytes = serde_json::to_vec(&sheet).unwrap();
    let parsed = parse_sheet(Path::new("decoupes.json"), &bytes).unwrap();
    let decisions = Decisions {
        sheet: PathBuf::from("decoupes.json"),
        by_image: read_answers(Path::new("decoupes.json"), &parsed).unwrap(),
        measurements: MeasureCache::read(&parsed),
    };
    let reused = decisions.measurements.get("image-a", &image).expect("hit");
    assert_eq!(reused.texels, measured.texels);
    assert_eq!(bits(&reused), bits(&measured));
    assert_eq!(reused.report(), measured.report());
    assert_eq!(reused.looks_like_cutout(), measured.looks_like_cutout());
    assert_eq!(decisions.verdict("image-a"), Some(true));
    let rewritten = build_sheet(&[], &decisions);
    assert_eq!(rewritten["textures"]["image-a"]["cutout"], true);
    let again = MeasureCache::read(&rewritten)
        .get("image-a", &image)
        .unwrap();
    assert_eq!(
        bits(&again),
        bits(&measured),
        "unused images retain exact measurements"
    );
}

#[test]
fn changed_source_dimensions_or_algorithm_and_old_sheets_are_cache_misses() {
    let image = image();
    let sheet = cached(&measure(&image));
    let cache = MeasureCache::read(&sheet);
    assert!(cache.get("different-image", &image).is_none());
    assert!(cache.get("image-a", &image::RgbaImage::new(2, 2)).is_none());
    for fingerprint in [Value::Null, json!("previous-algorithm")] {
        let mut changed = sheet.clone();
        changed["measurementAlgorithm"] = fingerprint;
        assert!(MeasureCache::read(&changed)
            .get("image-a", &image)
            .is_none());
        assert!(read_answers(Path::new("decoupes.json"), &changed).unwrap()["image-a"]);
    }
    let mut rows = serde_json::Map::new();
    MeasureCache::read(&json!({"version":1,"textures":{}})).keep_unused(&mut rows);
    assert!(rows.is_empty());
}

#[test]
fn corrupt_optional_measurements_are_ignored_but_invalid_answers_still_fail() {
    let image = image();
    let sheet = cached(&measure(&image));
    for (field, value) in [
        ("absent", json!(1.2)),
        ("present", json!(-0.1)),
        ("between", Value::Null),
        ("atContour", json!("NaN")),
        ("texels", json!(0)),
        ("texels", json!(2.5)),
        ("present", json!(1.0)),
    ] {
        let mut invalid = sheet.clone();
        let stored = &mut invalid["textures"]["image-a"]["measurement"];
        stored["values"][field] = value;
        stored["checksum"] = json!(checksum("image-a", &stored["values"]));
        assert!(
            MeasureCache::read(&invalid)
                .get("image-a", &image)
                .is_none(),
            "{field}"
        );
        assert!(read_answers(Path::new("decoupes.json"), &invalid).unwrap()["image-a"]);
    }
    let mut invalid = sheet;
    invalid["textures"]["image-a"]["cutout"] = json!("yes");
    assert!(read_answers(Path::new("decoupes.json"), &invalid).is_err());
}

#[test]
fn integrity_check_rejects_changed_values_or_a_record_moved_to_another_image() {
    let image = image();
    let mut sheet = cached(&measure(&image));
    let original = sheet["textures"]["image-a"].clone();
    sheet["textures"]["image-b"] = original;
    assert!(MeasureCache::read(&sheet).get("image-b", &image).is_none());
    sheet["textures"]["image-a"]["measurement"]["values"]["atContour"] = json!(0.125);
    assert!(MeasureCache::read(&sheet).get("image-a", &image).is_none());
}

/// The key a compiler whose whole source hashes to `implementation` stamps on its sheet.
fn stamped_by(implementation: &str, shape: &AlphaShape) -> Value {
    let key = hash(format!("{implementation}:{}", crate::plugins::fingerprint()).as_bytes());
    let mut sheet = cached(shape);
    sheet["measurementAlgorithm"] = json!(key);
    sheet
}

// The key follows the whole compiler's source hash, the one the compilation cache key uses: a
// change in any helper the measurement calls — not only in measure.rs — is another
// implementation hash, so the stored measurement is dropped instead of reused stale.
#[test]
fn a_measurement_is_reused_by_the_same_implementation_only() {
    let image = image();
    let measured = measure(&image);
    let same = MeasureCache::read(&stamped_by(crate::implementation_hash(), &measured));
    let reused = same
        .get("image-a", &image)
        .expect("same implementation: a hit");
    assert_eq!(bits(&reused), bits(&measured));
    let helper_changed = stamped_by("a compiler whose helper changed", &measured);
    assert!(MeasureCache::read(&helper_changed)
        .get("image-a", &image)
        .is_none());
    assert!(read_answers(Path::new("decoupes.json"), &helper_changed).unwrap()["image-a"]);
}

#[test]
fn freshly_measured_rows_publish_reusable_values_without_answering_for_the_user() {
    let image = image();
    let shape = measure(&image);
    let decisions = Decisions {
        sheet: PathBuf::from("decoupes.json"),
        by_image: BTreeMap::new(),
        measurements: MeasureCache::default(),
    };
    let entry = crate::cutout::sheet::Entry {
        sha256: "image-a".into(),
        name: "leaf.png".into(),
        shape: shape.clone(),
        answer: None,
        weight: 3,
    };
    let sheet = build_sheet(&[entry], &decisions);
    assert!(sheet["textures"]["image-a"]["cutout"].is_null());
    assert_eq!(sheet["textures"]["image-a"]["measure"], shape.report());
    let encoded = serde_json::to_vec(&sheet).unwrap();
    let parsed = parse_sheet(Path::new("decoupes.json"), &encoded).unwrap();
    let reused = MeasureCache::read(&parsed)
        .get("image-a", &image)
        .expect("the next compilation should use the published measurement");
    assert_eq!(bits(&reused), bits(&shape));
}
