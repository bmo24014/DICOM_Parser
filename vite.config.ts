import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // vtk.js imports xmlbuilder2, whose browser classes extend EventEmitter.
  resolve: { alias: { events: "events/" } },
  optimizeDeps: {
    // Keep the loader's import.meta.url worker/assets visible to Vite. Its
    // CommonJS codec factories still need conversion to browser ESM in dev.
    exclude: ["@cornerstonejs/dicom-image-loader"],
    include: [
      "@cornerstonejs/core",
      "@cornerstonejs/metadata",
      "dicom-parser",
      "events",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-charls/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-libjxl/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjpeg/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjph/wasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/jpeg-lossless-decoder-js",
      "@cornerstonejs/dicom-image-loader > pako",
    ],
  },
  worker: { format: "es" },
});
