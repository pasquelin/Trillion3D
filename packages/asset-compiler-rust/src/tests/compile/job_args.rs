//! Reading one compile job from the command line or a batch file (`compiler_args.rs`).
use super::*;

#[test]
fn parse_accepts_five_to_eight_args() {
    let cancelled = Arc::new(AtomicBool::new(false));
    let five = parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "slice".into(),
            "12".into(),
            "/assets/".into(),
        ],
        cancelled.clone(),
    )
    .expect("five");
    assert_eq!(five.threads, 2);
    assert_eq!(five.ram_budget_mb, 256);
    assert_eq!(five.simplification, "none");
    let seven = parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "full".into(),
            "12".into(),
            "4".into(),
            "128".into(),
            "/a/".into(),
        ],
        cancelled.clone(),
    )
    .expect("seven");
    assert_eq!(seven.threads, 4);
    assert_eq!(seven.ram_budget_mb, 128);
    let eight = parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "full".into(),
            "12".into(),
            "4".into(),
            "128".into(),
            "/a/".into(),
            "qem-endpoints".into(),
        ],
        cancelled,
    )
    .expect("eight");
    assert_eq!(eight.simplification, "qem-endpoints");
    // A value out of its choices is refused by the one check of a job's values, whichever form
    // named it, and the refusal names the field.
    let bicubic = parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "full".into(),
            "12".into(),
            "4".into(),
            "128".into(),
            "/a/".into(),
            "bicubic".into(),
        ],
        Arc::new(AtomicBool::new(false)),
    )
    .expect("bicubic parses");
    let refusal = validate_compile_options(&bicubic).expect_err("bicubic");
    assert_eq!(refusal.code, "INVALID_OPTIONS");
    assert!(refusal.message.contains(job_field::SIMPLIFICATION));
    assert!(parse_compiler_args(
        &[
            "s".into(),
            "c".into(),
            "full".into(),
            "12".into(),
            "4".into(),
            "128".into(),
            "/a/".into(),
            "qem-endpoints".into(),
            "dag".into()
        ],
        Arc::new(AtomicBool::new(false))
    )
    .is_err());
}
// Behaviour: the command line's job and a batch file's job are one reading (`job_options`): the
// same values give the same options, and the budget is read under `triangleBudget`, the name the
// single job has always had, not the batch's former `triangles`.
#[test]
fn command_line_and_batch_job_read_alike() {
    let cancelled = Arc::new(AtomicBool::new(false));
    let line: Vec<String> = ["s", "c", "full", "12", "4", "128", "/a/", "qem-endpoints"]
        .map(String::from)
        .to_vec();
    let positional = parse_compiler_args(&line, cancelled.clone()).expect("line");
    let job = json!({"source":"s","cache":"c","scope":"full","triangleBudget":12,"threads":4,"ramBudgetMb":128,"resourceBaseUrl":"/a/","simplification":"qem-endpoints"});
    let defaults = JobDefaults {
        scope: "full",
        threads: DEFAULT_THREADS,
        ram_budget_mb: DEFAULT_RAM_BUDGET_MB,
    };
    let batch = job_options(
        job.as_object().expect("object"),
        &defaults,
        cancelled.clone(),
    )
    .expect("batch");
    let read = |o: &Options| {
        (
            o.source.clone(),
            o.cache.clone(),
            o.scope.clone(),
            o.triangle_budget,
            o.threads,
            o.ram_budget_mb,
            o.resource_base.clone(),
            o.simplification.clone(),
            o.texture_formats.clone(),
        )
    };
    assert_eq!(read(&positional), read(&batch));
    let old = json!({"source":"s","cache":"c","resourceBaseUrl":"/a/","triangles":12});
    let old = job_options(old.as_object().expect("object"), &defaults, cancelled).expect("old");
    assert_eq!(old.triangle_budget, DEFAULT_TRIANGLE_BUDGET);
}
// Behaviour: a cook writes every block family unless told otherwise — each device then streams
// the blocks it samples, PNG the last fallback —, one family by name, or none.
#[test]
fn every_block_family_is_cooked_by_default() {
    use crate::texture_preview::BlockFormat;
    let args = |extra: &[&str]| -> Vec<String> {
        let mut args: Vec<String> = ["s", "c", "slice", "12", "/a/"].map(String::from).to_vec();
        args.extend(extra.iter().map(|arg| arg.to_string()));
        args
    };
    let formats = |extra: &[&str]| {
        parse_compiler_args(&args(extra), Arc::new(AtomicBool::new(false)))
            .map(|o| o.texture_formats)
    };
    assert_eq!(formats(&[]), Ok(BlockFormat::ALL.to_vec()));
    assert_eq!(
        formats(&["--textures-format=etc2"]),
        Ok(vec![BlockFormat::Etc2])
    );
    assert_eq!(formats(&["--textures-format=none"]), Ok(Vec::new()));
    assert!(formats(&["--textures-format=both"]).is_err());
}
// Behaviour: a count of values no form takes is refused with the usage, each run of fields a short
// form leaves out in brackets where the line takes it — spelled from the forms the reader reads.
#[test]
fn a_count_no_form_takes_is_refused_with_the_usage() {
    let usage = parse_compiler_args(&["s".into()], Arc::new(AtomicBool::new(false)))
        .err()
        .expect("one value is no form");
    let line = format!(
        "trillion3d-compiler source cache {} triangleBudget [threads ramBudgetMb] resourceBaseUrl [{}] ",
        SCOPES.join("|"),
        SIMPLIFICATIONS.join("|")
    );
    assert!(usage.contains(&line), "{usage}");
}
