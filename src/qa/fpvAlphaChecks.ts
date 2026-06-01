import type { FpvMetadata, FpvQaReport } from '../fpv/fpvTypes';

const colorDistance = (data: Uint8ClampedArray, offset: number, r: number, g: number, b: number) => Math.abs(data[offset] - r) + Math.abs(data[offset + 1] - g) + Math.abs(data[offset + 2] - b);

export function inspectFpvCanvas(canvas: HTMLCanvasElement, metadataShape: Pick<FpvMetadata, 'frameCount' | 'cellWidth' | 'cellHeight' | 'stripWidth' | 'stripHeight'>): FpvQaReport {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  let transparent = 0;
  let opaque = 0;
  let checkerish = 0;
  let white = 0;
  let black = 0;
  let sampled = 0;
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha < 255) transparent += 1;
      if (alpha === 255) opaque += 1;
      if (alpha > 245) {
        sampled += 1;
        if (colorDistance(data, i, 255, 255, 255) < 24) white += 1;
        if (colorDistance(data, i, 0, 0, 0) < 24) black += 1;
        const checkerA = colorDistance(data, i, 90, 90, 95) < 36;
        const checkerB = colorDistance(data, i, 104, 104, 109) < 36;
        if (checkerA || checkerB) checkerish += 1;
      }
    }
  }
  const cornerPoints = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
  const cornersOpaque = cornerPoints.some(([x, y]) => data[(y * width + x) * 4 + 3] > 245);
  const allPixelsOpaque = transparent === 0 && opaque > 0;
  const likelySolidWhiteBackground = sampled > 0 && white / sampled > 0.82;
  const likelySolidBlackBackground = sampled > 0 && black / sampled > 0.82;
  const likelyCheckerboardBackground = sampled > 0 && checkerish / sampled > 0.45;
  const likelyBakedBackground = allPixelsOpaque || cornersOpaque || likelySolidWhiteBackground || likelySolidBlackBackground || likelyCheckerboardBackground;
  const dimensionsMatch = width === metadataShape.stripWidth && height === metadataShape.stripHeight;
  const metadataMatches = metadataShape.stripWidth === metadataShape.frameCount * metadataShape.cellWidth && metadataShape.stripHeight === metadataShape.cellHeight && dimensionsMatch;
  let cellBleedRisk = false;
  if (dimensionsMatch) {
    for (let cell = 1; cell < metadataShape.frameCount; cell += 1) {
      const boundaryX = cell * metadataShape.cellWidth;
      for (let y = 0; y < height; y += 4) {
        const leftAlpha = data[(y * width + boundaryX - 1) * 4 + 3];
        const rightAlpha = data[(y * width + boundaryX) * 4 + 3];
        if (leftAlpha > 0 || rightAlpha > 0) {
          cellBleedRisk = true;
          break;
        }
      }
      if (cellBleedRisk) break;
    }
  }
  const warnings: string[] = [];
  if (!transparent) warnings.push('No transparent pixels found; exported strip may not contain real alpha.');
  if (allPixelsOpaque) warnings.push('All sampled pixels are opaque.');
  if (cornersOpaque) warnings.push('One or more export corners are opaque. Check for a baked background.');
  if (likelyCheckerboardBackground) warnings.push('Checkerboard-like colors detected in opaque sampled pixels.');
  if (likelySolidWhiteBackground) warnings.push('White background likely detected.');
  if (likelySolidBlackBackground) warnings.push('Black background likely detected.');
  if (!metadataMatches) warnings.push('Metadata dimensions do not match the rendered strip.');
  if (width !== 6144 || height !== 1024 || metadataShape.frameCount !== 6 || metadataShape.cellWidth !== 1024 || metadataShape.cellHeight !== 1024) warnings.push('FPV output contract mismatch; expected 6 frames of 1024×1024 for a 6144×1024 strip.');
  if (cellBleedRisk) warnings.push('Alpha detected on one or more cell boundaries; check for cell bleed/clipping.');
  return {
    alphaVerified: transparent > 0 && !allPixelsOpaque,
    hasTransparentPixels: transparent > 0,
    allPixelsOpaque,
    cornersOpaque,
    likelyBakedBackground,
    likelyCheckerboardBackground,
    likelySolidWhiteBackground,
    likelySolidBlackBackground,
    dimensionsMatch,
    metadataMatches,
    cellBleedRisk,
    warnings,
  };
}
