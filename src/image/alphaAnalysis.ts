export type Rect = { x:number; y:number; width:number; height:number };
export type DiagnosticStatus = 'pass' | 'warn' | 'fail';
export type SourceQualityDiagnostics = {
  alphaVerified:{ status:DiagnosticStatus; detail:string };
  dimensions:{ status:DiagnosticStatus; detail:string };
  alphaBounds:{ status:DiagnosticStatus; detail:string };
  edgeTouch:{ status:DiagnosticStatus; detail:string; touches:{ left:boolean; right:boolean; top:boolean; bottom:boolean } };
  cornerArtifacts:{ status:DiagnosticStatus; detail:string; nonTransparentCorners:string[] };
  fullCanvasPadRisk:{ status:DiagnosticStatus; detail:string };
  occupiedAreaPercent:{ status:DiagnosticStatus; detail:string; value:number };
  shouldRecrop:{ status:DiagnosticStatus; detail:string; value:boolean };
};
export type SpriteAnalysis = {
  width:number; height:number; hasAlpha:boolean; alphaVerified:boolean; sourceBounds:Rect; floorY:number; opaquePixelCount:number; warnings:string[]; sourceQuality:SourceQualityDiagnostics;
};

export function analyzeAlpha(imageData: ImageData): SpriteAnalysis {
  const { width, height, data } = imageData;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  let opaquePixelCount = 0;
  let sawPartialAlpha = false;
  let sawTransparent = false;

  for (let y=0; y<height; y++) {
    for (let x=0; x<width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > 0) {
        opaquePixelCount++;
        if (a < 255) sawPartialAlpha = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      } else {
        sawTransparent = true;
      }
    }
  }

  const hasPixels = opaquePixelCount > 0;
  const sourceBounds = hasPixels ? { x:minX, y:minY, width:maxX-minX+1, height:maxY-minY+1 } : {x:0,y:0,width:0,height:0};
  const alphaVerified = sawTransparent && (sawPartialAlpha || hasPixels);
  const warnings: string[] = [];
  if (!hasPixels) warnings.push('No visible pixels found.');
  if (!sawTransparent) warnings.push('Image appears fully opaque; likely missing meaningful transparency.');
  const touches = {
    left: hasPixels && sourceBounds.x === 0,
    right: hasPixels && sourceBounds.x + sourceBounds.width === width,
    top: hasPixels && sourceBounds.y === 0,
    bottom: hasPixels && sourceBounds.y + sourceBounds.height === height,
  };
  if (touches.left) warnings.push('Alpha bounds touch left edge.');
  if (touches.right) warnings.push('Alpha bounds touch right edge.');
  if (touches.top) warnings.push('Alpha bounds touch top edge.');
  if (touches.bottom) warnings.push('Alpha bounds touch bottom edge.');

  const nonTransparentCorners: string[] = [];
  const isOpaqueAt = (x: number, y: number) => data[(y * width + x) * 4 + 3] > 0;
  if (width > 0 && height > 0) {
    if (isOpaqueAt(0, 0)) nonTransparentCorners.push('top-left');
    if (isOpaqueAt(width - 1, 0)) nonTransparentCorners.push('top-right');
    if (isOpaqueAt(0, height - 1)) nonTransparentCorners.push('bottom-left');
    if (isOpaqueAt(width - 1, height - 1)) nonTransparentCorners.push('bottom-right');
  }
  if (nonTransparentCorners.length > 0) warnings.push(`Corner artifact pixels detected: ${nonTransparentCorners.join(', ')}.`);

  const occupiedAreaPercent = hasPixels ? (sourceBounds.width * sourceBounds.height) / (width * height) * 100 : 0;
  if (occupiedAreaPercent > 90) warnings.push('Source bounds occupy more than 90% of image area; likely full-canvas background/pad.');

  const shouldRecrop = touches.left || touches.right || touches.top || touches.bottom || nonTransparentCorners.length > 0 || occupiedAreaPercent > 90;

  const sourceQuality: SourceQualityDiagnostics = {
    alphaVerified: {
      status: alphaVerified ? 'pass' : 'fail',
      detail: alphaVerified ? 'Transparent PNG verified.' : 'Transparency quality failed verification.',
    },
    dimensions: {
      status: hasPixels ? 'pass' : 'warn',
      detail: `${width}x${height}`,
    },
    alphaBounds: {
      status: hasPixels ? 'pass' : 'warn',
      detail: hasPixels
        ? `x=${sourceBounds.x}, y=${sourceBounds.y}, w=${sourceBounds.width}, h=${sourceBounds.height}`
        : 'No non-transparent pixels detected.',
    },
    edgeTouch: {
      status: touches.left || touches.right || touches.top || touches.bottom ? 'warn' : 'pass',
      detail: touches.left || touches.right || touches.top || touches.bottom
        ? `Touches: ${Object.entries(touches).filter(([, v]) => v).map(([k]) => k).join(', ')}`
        : 'No alpha-bound edge contact.',
      touches,
    },
    cornerArtifacts: {
      status: nonTransparentCorners.length > 0 ? 'warn' : 'pass',
      detail: nonTransparentCorners.length > 0 ? `Corners: ${nonTransparentCorners.join(', ')}` : 'No corner artifacts.',
      nonTransparentCorners,
    },
    fullCanvasPadRisk: {
      status: occupiedAreaPercent > 90 ? 'warn' : 'pass',
      detail: occupiedAreaPercent > 90 ? 'Likely full-canvas background/pad.' : 'No full-canvas pad signal.',
    },
    occupiedAreaPercent: {
      status: occupiedAreaPercent > 90 ? 'warn' : 'pass',
      detail: `${occupiedAreaPercent.toFixed(2)}% of canvas occupied by source bounds.`,
      value: Number(occupiedAreaPercent.toFixed(4)),
    },
    shouldRecrop: {
      status: shouldRecrop ? 'warn' : 'pass',
      detail: shouldRecrop ? 'Recrop source before animation for cleaner alpha bounds.' : 'Recrop not required.',
      value: shouldRecrop,
    },
  };

  return { width, height, hasAlpha: true, alphaVerified, sourceBounds, floorY: hasPixels ? maxY : 0, opaquePixelCount, warnings, sourceQuality };
}
