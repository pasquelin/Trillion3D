# STL surface fixture

CC0, authored for this repository from the public ASCII STL grammar. Two named solids, one triangle each. Binary tests cover VisCAM and Magics colour conventions without rounding five-bit channels to eight bits.

STL has no standard colour space: this importer interprets both extensions as sRGB and converts RGB to the compiler's linear factors. Alpha remains linear. Facet order and solid names are preserved; unknown nonzero attribute encodings are refused.
