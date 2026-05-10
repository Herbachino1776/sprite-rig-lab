export function detectBleedRisk(spriteWidth:number, spriteHeight:number, cellWidth:number, cellHeight:number): boolean {
  return spriteWidth > cellWidth || spriteHeight > cellHeight;
}
