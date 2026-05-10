export type Rect = { x:number; y:number; width:number; height:number };
export type SpriteAnalysis = {
  width:number; height:number; hasAlpha:boolean; alphaVerified:boolean; sourceBounds:Rect; floorY:number; opaquePixelCount:number; warnings:string[];
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
  if (hasPixels && sourceBounds.width * sourceBounds.height > width * height * 0.95) warnings.push('Sprite occupies almost entire image; background pad risk.');

  return { width, height, hasAlpha: true, alphaVerified, sourceBounds, floorY: hasPixels ? maxY : 0, opaquePixelCount, warnings };
}
