export async function loadPngFromFile(file: File): Promise<HTMLImageElement> {
  if (file.type !== 'image/png') throw new Error('Please upload a PNG file.');
  const dataUrl = await file.arrayBuffer().then((b) => `data:${file.type};base64,${btoa(String.fromCharCode(...new Uint8Array(b)))}`);
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return image;
}
