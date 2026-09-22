// Keeps the stacked shutter + flip buttons clear of the resize handle even at 16:9 (360×202).
export const MIN_VIEWER_WIDTH = 360;
export const MAX_VIEWER_WIDTH = 1280;
export const DEFAULT_VIEWER_WIDTH = 640;

/** Clamp to the allowed range and to the space available (which wins on narrow screens). */
export function clampViewerWidth(width: number, available = Infinity): number {
  return Math.round(Math.min(Math.max(width, MIN_VIEWER_WIDTH), MAX_VIEWER_WIDTH, available));
}

/**
 * Width that puts the bottom-right corner of the viewer (horizontally centered, top edge fixed) as
 * close as possible to the pointer while keeping the aspect ratio. The corner sits at (w/2, w/aspect)
 * from the top center, so the pointer is projected onto that line.
 */
export function dragWidth(startWidth: number, dx: number, dy: number, aspect: number): number {
  const x = startWidth / 2 + dx;
  const y = startWidth / aspect + dy;
  return (x / 2 + y / aspect) / (1 / 4 + 1 / aspect ** 2);
}
