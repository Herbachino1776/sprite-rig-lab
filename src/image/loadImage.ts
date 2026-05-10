export async function loadPngFromFile(file: File): Promise<HTMLImageElement> {
  if (file.type && file.type !== 'image/png') {
    throw new Error('Please upload a PNG file.');
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The selected PNG could not be loaded as an image.'));
      image.src = objectUrl;
    });

    // Some browsers support decode() but can reject after onload for already-decoded blob URLs.
    // onload is enough for Canvas drawImage, so decode() is best-effort only.
    if (typeof image.decode === 'function') {
      try {
        await image.decode();
      } catch {
        // Ignore decode edge cases after a successful load event.
      }
    }

    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
