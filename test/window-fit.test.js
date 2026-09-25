const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DESIGN_SIZE,
  MIN_LAYOUT_SIZE,
  clampPositionToWorkArea,
  computeMainWindowFit
} = require("../src/electron/window-fit");

function cssViewport(fit) {
  return {
    width: fit.width / fit.zoomFactor,
    height: fit.height / fit.zoomFactor
  };
}

test("computeMainWindowFit keeps the design size unzoomed when the work area fits it", () => {
  const fit = computeMainWindowFit({ x: 0, y: 0, width: 1920, height: 1040 });

  assert.equal(fit.zoomFactor, 1);
  assert.equal(fit.width, DESIGN_SIZE.width);
  assert.equal(fit.height, DESIGN_SIZE.height);
  assert.equal(fit.x, 230);
  assert.equal(fit.y, 50);
});

test("computeMainWindowFit shrinks without zooming while the layout breakpoints still hold", () => {
  const fit = computeMainWindowFit({ x: 0, y: 0, width: 1400, height: 900 });

  assert.equal(fit.zoomFactor, 1);
  assert.equal(fit.width, 1400);
  assert.equal(fit.height, 900);
});

test("computeMainWindowFit zooms out a 1360x768 screen so the layout gets its minimum height", () => {
  const fit = computeMainWindowFit({ x: 0, y: 0, width: 1360, height: 728 });
  const viewport = cssViewport(fit);

  assert.ok(fit.zoomFactor < 1);
  assert.equal(fit.height, 728);
  assert.ok(fit.width <= 1360);
  assert.ok(Math.abs(viewport.height - MIN_LAYOUT_SIZE.height) < 1);
  assert.ok(viewport.width <= DESIGN_SIZE.width);
  assert.ok(viewport.width >= MIN_LAYOUT_SIZE.width);
});

test("computeMainWindowFit zooms by width when the work area is narrow", () => {
  const fit = computeMainWindowFit({ x: 0, y: 0, width: 1024, height: 728 });
  const viewport = cssViewport(fit);

  assert.equal(fit.width, 1024);
  assert.ok(Math.abs(viewport.width - MIN_LAYOUT_SIZE.width) < 1);
  assert.ok(viewport.height >= MIN_LAYOUT_SIZE.height);
});

test("computeMainWindowFit never exceeds the work area and centers within it", () => {
  const area = { x: 1920, y: 40, width: 1097, height: 617 };
  const fit = computeMainWindowFit(area);

  assert.ok(fit.width <= area.width);
  assert.ok(fit.height <= area.height);
  assert.ok(fit.x >= area.x && fit.x + fit.width <= area.x + area.width);
  assert.ok(fit.y >= area.y && fit.y + fit.height <= area.y + area.height);
});

test("computeMainWindowFit falls back to the design size for a missing work area", () => {
  const fit = computeMainWindowFit(undefined);

  assert.equal(fit.zoomFactor, 1);
  assert.equal(fit.width, DESIGN_SIZE.width);
  assert.equal(fit.height, DESIGN_SIZE.height);
});

test("clampPositionToWorkArea pulls a window back inside the work area", () => {
  const area = { x: 0, y: 0, width: 1360, height: 728 };

  assert.deepEqual(clampPositionToWorkArea({ x: 400, y: 300 }, { width: 1235, height: 728 }, area), { x: 125, y: 0 });
  assert.deepEqual(clampPositionToWorkArea({ x: -50, y: -20 }, { width: 800, height: 600 }, area), { x: 0, y: 0 });
  assert.deepEqual(clampPositionToWorkArea({ x: 100, y: 50 }, { width: 800, height: 600 }, area), { x: 100, y: 50 });
});
