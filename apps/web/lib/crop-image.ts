// Canvas-based crop extraction — takes the pixel-space crop rectangle
// react-easy-crop reports and draws just that region onto a fresh canvas,
// exported back out as a File ready to upload. This is what actually makes
// every listing photo end up framed consistently regardless of the source
// photo's original aspect ratio (see PhotoCropModal.tsx).

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function getCroppedImageFile(
  imageSrc: string,
  cropPixels: { x: number; y: number; width: number; height: number },
  fileName: string,
): Promise<File> {
  const image = await loadImage(imageSrc);

  const canvas = document.createElement("canvas");
  canvas.width = cropPixels.width;
  canvas.height = cropPixels.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    cropPixels.width,
    cropPixels.height,
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Failed to export cropped image");

  return new File([blob], fileName, { type: "image/jpeg" });
}
