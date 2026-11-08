/**
 * A 2D drawing surface: an OffscreenCanvas where the browser has one, and a page canvas where it does not. Safari added
 * OffscreenCanvas in iOS 16.4, and the WebKit build used for testing on Windows has none.
 */
export function drawingSurface(width: number, height: number) {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    return {
      context: canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D,
      toPng: () => canvas.convertToBlob({ type: "image/png" }),
    };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return {
    context: canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D,
    toPng: () =>
      new Promise<Blob>((done, fail) =>
        canvas.toBlob((blob) => (blob ? done(blob) : fail(new Error("The picture could not be saved."))), "image/png"),
      ),
  };
}

/**
 * The most pixels an image is read at. iOS Safari will not read back a canvas larger than 4096 x 4096, and drawing
 * apps often export bigger than that. It applies everywhere, so the same image gives the same files on every device.
 */
export const MAX_PIXELS = 4096 * 4096;

/** The size an image is read at: its own, or scaled down to fit MAX_PIXELS, keeping its shape. */
export function readSize(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * k)), height: Math.max(1, Math.floor(height * k)) };
}
