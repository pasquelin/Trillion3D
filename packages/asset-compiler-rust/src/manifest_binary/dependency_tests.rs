use super::*;

const TEMPLATES: Templates = Templates {
    binary: "clusters.bin",
    page: "../../objects/{sha}.bin",
    geometry: "../../objects/{sha}.bin",
    bundle: "../../objects/{sha}.bin",
};

/// The sample with a second, non-pinned bundle that depends on the pinned one.
fn two_bundles() -> Value {
    let mut manifest = super::tests::sample();
    let streams = &mut manifest["primitives"][0]["streams"];
    let mut second = streams["pages"][0].clone();
    second["dependencies"] = json!([0]);
    streams["pages"].as_array_mut().unwrap().push(second);
    streams["dependencyBound"] = json!(1);
    streams["maxDependencies"] = json!(1);
    manifest
}

fn column(bytes: &[u8], index: usize) -> &[u8] {
    let at = (HEADER_WORDS + index * 2) * 4;
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
    &bytes[word(at)..word(at) + word(at + 4)]
}

#[test]
fn bundle_dependencies_are_a_count_per_bundle_then_the_flat_lists() {
    let (slim, bytes) = split(&two_bundles(), &TEMPLATES, &[]).expect("split");
    let words = |index| -> Vec<u32> {
        column(&bytes, index)
            .chunks(4)
            .map(|word| u32::from_le_bytes(word.try_into().unwrap()))
            .collect()
    };
    assert_eq!(words(BUNDLE_DEPENDENCY_COUNT), vec![0, 1]);
    assert_eq!(words(BUNDLE_DEPENDENCY), vec![0]);
    for field in ["dependencyBound", "maxDependencies"] {
        assert_eq!(
            slim["primitives"][0]["binary"]["streams"][field],
            json!(1),
            "the published {field} travels in the small JSON"
        );
    }
}

#[test]
fn a_bundle_without_dependencies_or_depending_outside_its_primitive_is_refused() {
    let mut absent = two_bundles();
    absent["primitives"][0]["streams"]["pages"][1]
        .as_object_mut()
        .unwrap()
        .remove("dependencies");
    let error = split(&absent, &TEMPLATES, &[]).expect_err("refused");
    assert!(error.message.contains("bundle.dependencies"), "{error}");
    let mut outside = two_bundles();
    outside["primitives"][0]["streams"]["pages"][1]["dependencies"] = json!([2]);
    let error = split(&outside, &TEMPLATES, &[]).expect_err("refused");
    assert!(error.message.contains("outside its primitive"), "{error}");
}
