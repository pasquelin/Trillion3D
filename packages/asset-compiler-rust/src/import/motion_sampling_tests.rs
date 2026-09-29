use super::*;

const FBX: &str = include_str!("../../../../tests/fixtures/formats/import-fbx/bend.fbx");

#[test]
fn rotating_and_scaling_bones_retain_source_motion_at_unwritten_times() {
    for (property, values) in [("Lcl Rotation", "0,720"), ("Lcl Scaling", "1,4")] {
        let mut text = FBX
            .replace("Lcl Translation", property)
            .replace("a: 0,2\n", &format!("a: {values}\n"));
        if property == "Lcl Scaling" {
            for axis in ["X", "Y", "Z"] {
                text = text.replace(
                    &format!("P: \"d|{axis}\", \"Number\", \"\", \"A\",0"),
                    &format!("P: \"d|{axis}\", \"Number\", \"\", \"A\",1"),
                );
            }
        } else {
            text = text.replace(
                "C: \"OP\",6300,6200, \"d|X\"",
                "C: \"OP\",6300,6200, \"d|X\"\n C: \"OP\",6300,6200, \"d|Y\"",
            );
        }
        let scene = ufbx::load_memory(text.as_bytes(), Default::default()).unwrap();
        contract::validate(&scene).expect("ordinary rotating/scaling skeleton accepted");
        let bone = scene
            .nodes
            .iter()
            .find(|node| &*node.element.name == "stem")
            .unwrap();
        let written = [Written {
            typed: bone.element.typed_id as usize,
            node: 0,
            geometry: false,
            pose: true,
            channels: vec![],
        }];
        let stack = &scene.anim_stacks[0];
        let output = sample(&scene, stack, &written, || Ok(())).unwrap();
        assert_eq!(output.first().unwrap().time, 0.0);
        assert_eq!(output.last().unwrap().time, 1.0);
        if property == "Lcl Rotation" {
            assert!(
                output.len() > 24,
                "two full turns cannot collapse to identity"
            );
        }
        let mut worst = 0.0_f64;
        for step in 1..1000 {
            let time = step as f64 / 1000.0;
            let pair = output
                .windows(2)
                .find(|pair| time >= pair[0].time && time <= pair[1].time)
                .unwrap();
            let actual = evaluate(&scene, stack, &written, time).unwrap();
            worst = worst.max(error(&pair[0], &pair[1], &actual));
        }
        assert!(worst <= ERROR, "{property}: {worst} exceeds {ERROR}");
    }
}

#[test]
fn cubic_rotation_is_refined_instead_of_refused() {
    let text = FBX
        .replace("Lcl Translation", "Lcl Rotation")
        .replace("a: 0,2\n", "a: 0,120\n")
        .replace("24836", "24840");
    let scene = ufbx::load_memory(text.as_bytes(), Default::default()).unwrap();
    contract::validate(&scene).unwrap();
    let bone = scene
        .nodes
        .iter()
        .find(|node| &*node.element.name == "stem")
        .unwrap();
    let written = [Written {
        typed: bone.element.typed_id as usize,
        node: 0,
        geometry: false,
        pose: true,
        channels: vec![],
    }];
    let stack = &scene.anim_stacks[0];
    let output = sample(&scene, stack, &written, || Ok(())).unwrap();
    for step in 1..300 {
        let time = step as f64 / 300.0;
        let pair = output
            .windows(2)
            .find(|pair| time >= pair[0].time && time <= pair[1].time)
            .unwrap();
        let actual = evaluate(&scene, stack, &written, time).unwrap();
        assert!(error(&pair[0], &pair[1], &actual) <= ERROR);
    }
}
