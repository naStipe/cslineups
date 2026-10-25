// Module worker that re-encodes screenshots off the main thread (see
// compressImage in js/image-upload.js for the rules, which must match:
// max 1920px on the long side, WebP q0.82, JPEG q0.85 when the browser
// can't encode WebP, keep the original when re-encoding isn't smaller and
// didn't resize). Decoding a 2560x1440 PNG and encoding it again takes
// ~200ms of CPU per image; on the main thread 8 of them froze the modal for
// over a second.
//
// Loaded with new Worker(new URL("./image-worker.js", import.meta.url),
// { type: "module" }), so it resolves next to image-upload.js even after the
// build moves js/ into js/<hash>/. Kept flat in js/ on purpose (the build only
// copies js/*.js).
//
// Message in:  { id, file, maxDim, webpQuality, jpegQuality }
// Message out: { id, blob, ms }  or  { id, error }

self.onmessage = async (e) => {
  const { id, file, maxDim, webpQuality, jpegQuality } = e.data;
  const t0 = performance.now();
  try {
    const bitmap = await createImageBitmap(file);
    let width = bitmap.width, height = bitmap.height;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    const resized = width !== bitmap.width;
    bitmap.close();

    let blob = await canvas.convertToBlob({ type: "image/webp", quality: webpQuality });
    if (!blob || blob.type !== "image/webp") blob = await canvas.convertToBlob({ type: "image/jpeg", quality: jpegQuality });
    const out = blob && (blob.size < file.size || resized) ? blob : file;
    self.postMessage({ id, blob: out, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || "Could not read that image." });
  }
};
