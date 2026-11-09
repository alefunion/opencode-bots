// Maximum SVGO compression for the logo files. Three decimals keep the shade
// opacities exact; inlineStyles stays off so the favicon's dark-mode rule keeps
// working.
export default {
  multipass: true,
  floatPrecision: 3,
  plugins: [{ name: "preset-default", params: { overrides: { inlineStyles: false } } }],
}
