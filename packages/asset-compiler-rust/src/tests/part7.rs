use super::*;

#[test]
fn cancelled_import_reports_cancelled() {
    let (root, options) = obj_fixture("quad.obj", false);
    options.cancelled.store(true, Ordering::Relaxed);
    assert_eq!(
        compile(&options, |_| {}).expect_err("cancelled").code,
        "CANCELLED"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
