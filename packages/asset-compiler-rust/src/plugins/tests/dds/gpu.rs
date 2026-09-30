use super::{bytes, registry};

#[test]
fn gpu_dds_keeps_every_block_and_mip_with_a_budget_smaller_than_rgba() {
    let payload: Vec<u8> = (0..24).collect();
    let file = bytes::container(bytes::fourcc_format(b"DXT1"), 5, 4, 2, &payload);
    let decoded = registry::decode_for_gpu(&file, 24, &["bc1-rgba-unorm"])
        .unwrap()
        .unwrap();
    let registry::DecodedImage::Blocks(blocks) = decoded.image else {
        panic!("CPU pixels");
    };
    assert_eq!(blocks.format, "bc1-rgba-unorm");
    assert_eq!(blocks.transfer, registry::Transfer::Srgb);
    assert_eq!(blocks.levels.len(), 2);
    assert_eq!((blocks.levels[0].width, blocks.levels[0].height), (5, 4));
    assert_eq!(blocks.levels[0].data, payload[..16]);
    assert_eq!((blocks.levels[1].width, blocks.levels[1].height), (2, 2));
    assert_eq!(blocks.levels[1].data, payload[16..]);
    assert_eq!(
        registry::decode_for_gpu(&file, 23, &["bc1-rgba-unorm"]).err(),
        Some("image-block-budget-exceeded")
    );
    assert!(registry::decode_for_gpu(&file, 128, &[]).unwrap().is_none());
    assert!(matches!(
        registry::decode(&file, 128).unwrap().image,
        registry::DecodedImage::Rgba8(_)
    ));
}

#[test]
fn gpu_dds_preserves_each_declared_native_codec_without_transcoding() {
    for (dxgi, format, count) in [
        (71, "bc1-rgba-unorm", 8),
        (74, "bc2-rgba-unorm", 16),
        (77, "bc3-rgba-unorm", 16),
        (80, "bc4-r-unorm", 8),
        (83, "bc5-rg-unorm", 16),
        (98, "bc7-rgba-unorm", 16),
    ] {
        let payload = vec![0x81; count];
        let file = bytes::dx10(dxgi, 4, 4, &payload);
        let decoded = registry::decode_for_gpu(&file, count as u64, &[format])
            .unwrap()
            .unwrap();
        let registry::DecodedImage::Blocks(blocks) = decoded.image else {
            panic!("CPU pixels");
        };
        assert_eq!(blocks.format, format);
        assert_eq!(blocks.levels[0].data, payload);
        assert_eq!(decoded.transfer, registry::Transfer::Linear);
    }
}
