// The renderer layout is authored for DESIGN_SIZE and has breakpoints that hold up down to
// MIN_LAYOUT_SIZE. When a display's work area is smaller than that (e.g. 1360x768 at 100%, or
// 1080p at 150% scaling), the window is shrunk and the page is zoomed out uniformly instead,
// so the renderer still lays out at a size it supports rather than collapsing onto itself.
const DESIGN_SIZE = Object.freeze({ width: 1460, height: 940 });
const MIN_LAYOUT_SIZE = Object.freeze({ width: 1280, height: 860 });
const MIN_ZOOM_FACTOR = 0.5;

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function computeMainWindowFit(workArea = {}) {
  const area = {
    x: Number(workArea.x) || 0,
    y: Number(workArea.y) || 0,
    width: toPositiveNumber(workArea.width, DESIGN_SIZE.width),
    height: toPositiveNumber(workArea.height, DESIGN_SIZE.height)
  };

  const zoomFactor = Math.max(
    MIN_ZOOM_FACTOR,
    Math.min(1, area.width / MIN_LAYOUT_SIZE.width, area.height / MIN_LAYOUT_SIZE.height)
  );

  // Never let the zoomed-out layout grow wider or taller than the design itself.
  const width = Math.floor(Math.min(area.width, DESIGN_SIZE.width * zoomFactor));
  const height = Math.floor(Math.min(area.height, DESIGN_SIZE.height * zoomFactor));

  return {
    width,
    height,
    zoomFactor,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2)
  };
}

// Keeps a window's top-left where it is, but pulls it back inside the work area if the
// new size would push it off an edge.
function clampPositionToWorkArea(position, size, workArea) {
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);
  return {
    x: Math.round(Math.min(Math.max(position.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(position.y, workArea.y), maxY))
  };
}

module.exports = {
  DESIGN_SIZE,
  MIN_LAYOUT_SIZE,
  clampPositionToWorkArea,
  computeMainWindowFit
};
