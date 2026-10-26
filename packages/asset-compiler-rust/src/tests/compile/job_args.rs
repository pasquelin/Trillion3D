//! Reading one compile job from the command line or a batch file (`compiler/args.rs`).
use super::*;
use crate::voxel::VoxelSettings;

/// The command line's job read from `line`, under a fresh cancellation flag.
fn parse(line: &[&str]) -> std::result::Result<Options, String> {
    let line: Vec<String> = line.iter().map(|arg| arg.to_string()).collect();
    parse_compiler_args(&line, Arc::new(AtomicBool::new(false)))
}

/// A batch job read from `job` under a batch's defaults, under a fresh cancellation flag.
fn read_job(job: &Value) -> std::result::Result<Options, String> {
    let defaults = JobDefaults {
        scope: SCOPES[1],
        threads: machine_threads(),
        ram_budget_mb: DEFAULT_RAM_BUDGET_MB,
    };
    let flag = Arc::new(AtomicBool::new(false));
    job_options(job.as_object().expect("object"), &defaults, flag)
}

#[test]
fn parse_accepts_five_to_eight_args() {
    let five = parse(&["s", "c", "slice", "12", "/assets/"]).expect("five");
    assert_eq!(five.threads, machine_threads());
    assert_eq!(five.ram_budget_mb, crate::DEFAULT_RAM_BUDGET_MB);
    assert_eq!(five.simplification, "qem-endpoints");
    let seven = parse(&["s", "c", "full", "12", "4", "128", "/a/"]).expect("seven");
    assert_eq!(seven.threads, 4);
    assert_eq!(seven.ram_budget_mb, 128);
    // An empty value names nothing: the field takes its default, the others keep their places.
    let unnamed = parse(&["s", "c", "full", "12", "", "128", "/a/"]).expect("unnamed threads");
    assert_eq!(unnamed.threads, machine_threads());
    assert_eq!(unnamed.ram_budget_mb, 128);
    let eight = parse(&["s", "c", "full", "12", "4", "128", "/a/", "none"]);
    assert_eq!(eight.expect("eight").simplification, "none");
    // A value out of its choices is refused by the one check of a job's values, whichever form
    // named it, and the refusal names the field.
    let bicubic = parse(&["s", "c", "full", "12", "4", "128", "/a/", "bicubic"]);
    let refusal = validate_compile_options(&bicubic.expect("bicubic parses")).expect_err("bicubic");
    assert_eq!(refusal.code, "INVALID_OPTIONS");
    assert!(refusal.message.contains(job_field::SIMPLIFICATION));
    let nine = [
        "s",
        "c",
        "full",
        "12",
        "4",
        "128",
        "/a/",
        "qem-endpoints",
        "dag",
    ];
    assert!(parse(&nine).is_err());
}
// Behaviour: the command line's job and a batch file's job are one reading (`job_options`): the
// same values give the same options, and the budget is read under `triangleBudget`, the name the
// single job has always had.
#[test]
fn command_line_and_batch_job_read_alike() {
    let positional =
        parse(&["s", "c", "full", "12", "4", "128", "/a/", "qem-endpoints"]).expect("line");
    let job = json!({"source":"s","cache":"c","scope":"full","triangleBudget":12,"threads":4,"ramBudgetMb":128,"resourceBaseUrl":"/a/","simplification":"qem-endpoints"});
    let batch = read_job(&job).expect("batch");
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
}
// Behaviour: a job key no reader takes is refused by name, never dropped: the former `triangles`
// would otherwise cook at `DEFAULT_TRIANGLE_BUDGET` unannounced.
#[test]
fn an_unknown_job_field_is_refused_by_name() {
    let old = json!({"id":"a","source":"s","cache":"c","resourceBaseUrl":"/a/","triangles":12});
    let refused = read_job(&old).err().expect("refused");
    assert!(refused.contains("triangles"), "{refused}");
    let named =
        json!({"id":"a","source":"s","cache":"c","resourceBaseUrl":"/a/","texturesFormat":"bc7"});
    read_job(&named).expect("named");
}
// Behaviour: a text field holding another type is refused by name, never read as absent: a
// `simplification` of `true` or a `scope` of `1` would otherwise cook at the default unannounced.
#[test]
fn a_mistyped_text_field_is_refused_by_name() {
    for field in [
        job_field::SIMPLIFICATION,
        job_field::SCOPE,
        "texturesFormat",
        ID_FIELD,
    ] {
        let mut job = json!({"source":"s","cache":"c","resourceBaseUrl":"/a/"});
        job[field] = json!(true);
        let refused = read_job(&job).err().expect("refused");
        assert!(refused.contains(field), "{refused}");
    }
    read_job(&json!({"source":"s","cache":"c","resourceBaseUrl":"/a/","scope":null}))
        .expect("null");
}
// Behaviour: a cook writes the stored BC family alone unless told otherwise — a device without
// it decodes BC —, the stored one and one family by name, or every family under `all`; no value
// leaves the stored family out.
#[test]
fn the_stored_block_family_alone_is_cooked_by_default() {
    use crate::texture::BlockFormat;
    let formats = |extra: &[&str]| {
        parse(&[&["s", "c", "slice", "12", "/a/"][..], extra].concat()).map(|o| o.texture_formats)
    };
    assert_eq!(formats(&[]), Ok(vec![BlockFormat::STORED]));
    assert_eq!(
        formats(&["--textures-format=all"]),
        Ok(BlockFormat::ALL.to_vec())
    );
    assert_eq!(
        formats(&["--textures-format=etc2"]),
        Ok(vec![BlockFormat::STORED, BlockFormat::Etc2])
    );
    assert_eq!(
        formats(&["--textures-format=bc7"]),
        Ok(vec![BlockFormat::STORED])
    );
    assert!(formats(&["--textures-format=none"]).is_err());
    assert!(formats(&["--textures-format=both"]).is_err());
}
// Behaviour: a count of values no form takes is refused with the usage, each run of fields a short
// form leaves out in brackets where the line takes it — spelled from the forms the reader reads.
#[test]
fn a_count_no_form_takes_is_refused_with_the_usage() {
    let usage = parse(&["s"]).err().expect("one value is no form");
    let line = format!(
        "trillion3d-compiler source cache {} triangleBudget [threads ramBudgetMb] resourceBaseUrl [{}] ",
        SCOPES.join("|"),
        SIMPLIFICATIONS.join("|")
    );
    assert!(usage.contains(&line), "{usage}");
}
// Behaviour: an empty `resourceBaseUrl` is refused once, by the check of a job's values, whichever
// form named the job; the textures-format refusal and the usage name every block family.
#[test]
fn one_refusal_names_each_missing_value_and_every_choice() {
    use crate::texture::BlockFormat;
    let job = json!({"source":"s","cache":"c"});
    let read = read_job(&job).expect("read");
    let refusal = validate_compile_options(&read).expect_err("no resource base");
    assert!(refusal.message.contains(job_field::RESOURCE_BASE_URL));
    let refused = parse(&["s", "c", "slice", "12", "/a/", "--textures-format=both"]);
    let usage = parse(&["s"]).err().expect("usage");
    for name in BlockFormat::ALL.map(BlockFormat::name) {
        assert!(refused.as_ref().err().expect("both").contains(name));
    }
    let families = BlockFormat::ALL.map(BlockFormat::name).join("|");
    assert!(usage.contains(&format!("all|{families}")), "{usage}");
}

// Behaviour: a mesh's voxel settings are its build's (`meshBuild`): for each, the first rule
// matching one of its objects, the scene's, the mesh's own `extras`, the reference's default.
#[test]
fn a_meshs_voxel_settings_follow_the_job_then_its_extras_then_the_defaults() {
    let g = json!({
        "nodes": [{"name": "Tower", "mesh": 0}, {"name": "Bush", "mesh": 1}],
        "meshes": [{}, {"extras": {"voxelRays": 20, "voxelNdf": false}}]
    });
    let meshes = |job: Option<&Value>| MeshBuildOptions::read(job).expect("read").meshes(&g);
    let none = meshes(None).expect("meshes");
    assert_eq!(none[0].voxels, VoxelSettings::default());
    assert_eq!(none[0].voxels.rays(), 64);
    assert_eq!((none[1].voxels.asked_rays, none[1].voxels.ndf), (20, false));
    let job = json!({"voxelRays": 128, "voxelOpacity": true, "objects": [
        {"match": "Tower", "voxelRays": 0, "voxelLevel": 2, "voxelBackUp": 0.5, "voxelSeparable": true}
    ]});
    let named = meshes(Some(&job)).expect("meshes");
    let (tower, bush) = (named[0].voxels, named[1].voxels);
    assert_eq!((tower.asked_rays, tower.level, tower.back_up), (0, 2, 0.5));
    assert_eq!(
        (tower.separable, tower.ndf, tower.opacity),
        (true, true, true)
    );
    // The scene's rays beat the mesh's own; what the scene leaves out the extras name.
    assert_eq!(
        (bush.asked_rays, bush.ndf, bush.opacity),
        (128, false, true)
    );
}

// Behaviour: a voxel casts the rays asked for, at most 1 024 and past 1 a whole number of packets
// of 16; 0 or 1 casts one, and with one, or an opacity to keep the coverage in, none is handed
// over; a voxel no ray hit is sampled again a level up only below 32 rays cast; from the build's
// voxel level up every group is voxels, a level below 0 acting as the first.
#[test]
fn the_voxel_settings_read_as_the_rays_and_levels_they_mean() {
    let rays = |asked_rays| VoxelSettings {
        asked_rays,
        ..Default::default()
    };
    let cast = [0, 1, 2, 16, 17, 64, 1000, 1024, 5000].map(|n| rays(n).rays());
    assert_eq!(cast, [0, 1, 16, 16, 32, 64, 1008, 1024, 1024]);
    assert!(rays(1).single() && !rays(2).single());
    assert!(!rays(1).redistributes() && rays(64).redistributes());
    assert!(!VoxelSettings {
        opacity: true,
        ..rays(64)
    }
    .redistributes());
    assert!(rays(16).remembers_empty() && !rays(17).remembers_empty());
    let from = |level| VoxelSettings {
        level,
        ..Default::default()
    };
    assert!(![1, 2, 9].iter().any(|&l| from(0).forces(l)));
    assert_eq!(
        [1, 2, 3, 4].map(|l| from(3).forces(l)),
        [false, false, true, true]
    );
    assert!(from(-2).forces(1));
}

// Behaviour: a voxel setting of the wrong kind is the job's refusal, naming the setting, from the
// job's `meshBuild` as from a mesh's own `extras`.
#[test]
fn a_voxel_setting_of_the_wrong_kind_is_refused_by_name() {
    for (job, name) in [
        (json!({"voxelRays": -1}), "voxelRays"),
        (json!({"voxelRays": 1.5}), "voxelRays"),
        (json!({"voxelLevel": 2147483648u64}), "voxelLevel"),
        (json!({"voxelBackUp": "far"}), "voxelBackUp"),
        (json!({"voxelSeparable": 1}), "voxelSeparable"),
        (
            json!({"objects": [{"match": "Tower", "voxelNdf": "yes"}]}),
            "voxelNdf",
        ),
    ] {
        let refusal = MeshBuildOptions::read(Some(&job)).expect_err(name);
        assert!(refusal.contains(name), "{refusal}");
    }
    let g = json!({"meshes": [{"extras": {"voxelOpacity": 0}}]});
    let refused = MeshBuildOptions::read(None).expect("read").meshes(&g);
    assert!(refused
        .expect_err("extras")
        .message
        .contains("voxelOpacity"));
}

// Behaviour: a mesh builds its assembly only where its build allows it: not by default, then by
// the job's rule for its objects, the scene's setting, or its own `extras`, in that order.
#[test]
fn a_mesh_builds_its_assembly_only_where_its_build_allows_it() {
    let g = json!({
        "nodes": [
            {"name": "Facade", "mesh": 0},
            {"name": "Wall", "mesh": 1},
            {"name": "Roof", "mesh": 2},
        ],
        "meshes": [{}, {}, {"extras": {"allowAssemblies": true}}]
    });
    let allowed = |job: Option<&Value>| -> Vec<bool> {
        let built = MeshBuildOptions::read(job).expect("read").meshes(&g);
        built
            .expect("meshes")
            .iter()
            .map(|m| m.allow_assemblies)
            .collect()
    };
    assert_eq!(allowed(None), [false, false, true]);
    let ruled = json!({"objects": [{"match": "Facade", "allowAssemblies": true}]});
    assert_eq!(allowed(Some(&ruled)), [true, false, true]);
    // The scene's setting beats the mesh's own extras.
    assert_eq!(
        allowed(Some(&json!({"allowAssemblies": false}))),
        [false; 3]
    );
    let refusal = MeshBuildOptions::read(Some(&json!({"allowAssemblies": 1})));
    assert!(refusal.expect_err("a number").contains("allowAssemblies"));
}
