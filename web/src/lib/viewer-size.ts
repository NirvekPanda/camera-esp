// Keeps the stacked shutter + flip buttons clear of the resize handle even at 16:9 (360×202).
export const MIN_VIEWER_WIDTH = 360;
export const MAX_VIEWER_WIDTH = 1280;
export const DEFAULT_VIEWER_WIDTH = 640;

/** Clamp to the allowed range and to the space available (which wins on narrow screens). */
export function clampViewerWidth(width: number, available = Infinity): number {
  return Math.round(Math.min(Math.max(width, MIN_VIEWER_WIDTH), MAX_VIEWER_WIDTH, available));
}

/**
 * Width that puts the viewer's bottom-right corner as close as possible to the pointer while
 * keeping the aspect ratio: the pointer projected onto the viewer's diagonal.
 */
export function dragWidth(startWidth: number, dx: number, dy: number, aspect: number): number {
  const x = startWidth + dx;
  const y = startWidth / aspect + dy;
  return (x + y / aspect) / (1 + 1 / aspect ** 2);
}
