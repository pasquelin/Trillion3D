use super::{bytes, fixture, registry};

#[test]
fn gpu_ktx2_keeps_native_blocks_and_falls_back_when_the_device_cannot_sample_them() {
    let payload = [0x42; 16];
    let file = bytes::container(146, 4, 4, &payload);
    let decoded = registry::decode_for_gpu(&file, 16, &["bc7-rgba-unorm"])
        .unwrap()
        .unwrap();
    let registry::DecodedImage::Blocks(blocks) = decoded.image else {
        panic!("CPU pixels");
    };
    assert_eq!(blocks.levels[0].data, payload);
    assert_eq!(decoded.transfer, registry::Transfer::Srgb);
    assert!(registry::decode_for_gpu(&file, 128, &[]).unwrap().is_none());
    assert!(matches!(
        registry::decode(&file, 64).unwrap().image,
        registry::DecodedImage::Rgba8(_)
    ));
}

#[test]
fn basis_payloads_transcode_to_gpu_blocks_without_allocating_an_rgba_surface() {
    for name in ["uastc.ktx2", "basis.ktx2"] {
        let file = fixture("ktx2", name);
        let (width, height) = registry::by_head(&file).unwrap().dimensions(&file).unwrap();
        let budget = u64::from(width.div_ceil(4)) * u64::from(height.div_ceil(4)) * 32;
        let decoded = registry::decode_for_gpu(&file, budget, &["bc7-rgba-unorm"])
            .unwrap()
            .unwrap();
        let registry::DecodedImage::Blocks(blocks) = decoded.image else {
            panic!("CPU pixels");
        };
        assert_eq!(blocks.format, "bc7-rgba-unorm");
        assert_eq!(
            (blocks.levels[0].width, blocks.levels[0].height),
            (width, height)
        );
        assert_eq!(
            blocks.levels[0].data.len(),
            width.div_ceil(4) as usize * height.div_ceil(4) as usize * 16
        );
    }
}
