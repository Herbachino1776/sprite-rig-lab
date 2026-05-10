export function idleTransform(frameIndex:number, frameCount:number) {
  const t = (frameIndex / frameCount) * Math.PI * 2;
  return {
    bobY: Math.sin(t) * 6,
    scale: 1 + Math.sin(t + Math.PI / 3) * 0.018
  };
}
