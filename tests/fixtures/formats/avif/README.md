# AVIF still image

`rgba.avif` is a 2 by 2 source authored for this test, encoded with Pillow/libavif,
quality 100, 4:4:4, speed 0, one thread. Source RGBA rows are
`[255,0,0,255], [0,255,0,192]` and `[0,0,255,128], [255,255,255,64]`.
AV1's source encoding is lossy; the compiler does not re-encode it.
`expected.json` records an independent Pillow/libavif decode, not the input pixels.
RGB conversion permits one code value of decoder rounding; alpha is exact.

The native adapter currently requires an explicit `nclx` sRGB transfer property
associated with the primary item through `pitm`/`ipma`. It refuses missing,
unassociated or unspecified transfer descriptions because the chosen decoder API
does not expose the AV1 transfer characteristics. An unrelated `colr` box cannot
justify interpreting the primary image as sRGB. Transform properties and animated
containers remain explicit refusals. Non-BT.709 primaries (including unspecified ones) and ICC profiles are
explicitly refused; this adapter does not claim colour-profile conversion.
