import type { SpriteAnalysis } from '../image/alphaAnalysis';

export type ProjectState = {
  frameCount: 5 | 6;
  cellWidth: number;
  cellHeight: number;
  analysis: SpriteAnalysis | null;
};

export const defaultState: ProjectState = { frameCount: 6, cellWidth: 1024, cellHeight: 1024, analysis: null };
