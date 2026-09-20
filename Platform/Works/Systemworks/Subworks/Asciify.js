#!/usr/bin/env node
// ship
// designed and built by onyxpowered.
//
// Renders an image as monochrome ASCII art in the terminal, live-resized to
// the terminal's current width, edge-to-edge, and always centered vertically.

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// Dense-to-sparse ASCII gradient, reversed so index 0 is sparsest (darkest)
// and the last index is densest (brightest) -- full charset for fine shading.
// Used for "direct" mode: bright strokes/gradients already present in the
// source (e.g. a scan of rendered text), where the extra levels read as tone.
const RAMP_DENSE_TO_SPARSE = '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. ';
const RAMP_FILL = Array.from(RAMP_DENSE_TO_SPARSE).reverse().join('');
// Short, light ramp for "outline" mode: a Sobel-extracted edge is basically
// binary (on the line or not), so the chunky block glyphs in RAMP_FILL just
// make the curve look like a thick filled band. Fewer, lighter levels keep
// the stroke reading as a single clean line.
const RAMP_OUTLINE = ' .:-=+*#%@';
// Terminal glyphs are roughly twice as tall as they are wide, so we sample
// half as many rows as the aspect ratio would otherwise suggest.
const CHAR_ASPECT_CORRECTION = 0.5;
const RESIZE_DEBOUNCE_MS = 40;
// Softens jagged pixel-level edges (and JPEG block noise) without smearing
// thin strokes into mush.
const SOURCE_BLUR_SIGMA = 0.5;
// A canvas this bright on average is treated as a light background with a
// filled/colored shape on it, rather than bright strokes on a dark field.
const LIGHT_BACKGROUND_THRESHOLD = 0.5;
// <1 brightens midtones, so a stroke that only partly fills (or dilates into)
// a cell still clears the ramp's threshold instead of rounding down to blank.
const CONTRAST_GAMMA = 0.75;
// Coverage at or below this is treated as pure background. Needed because the
// gamma brightening above would otherwise amplify stray sub-visible noise
// (PNG compression rounding, JPEG blocking) into visible specks everywhere.
const NOISE_FLOOR = 0.1;
// Soft max-dilate weights: bleed each cell's brightness into its neighbors at
// less than full strength so a stroke that clips between two cells still
// reads as one continuous line. Kept low for a thin, clean stroke.
const DILATE_ORTHOGONAL_WEIGHT = 0.45;
const DILATE_DIAGONAL_WEIGHT = 0.2;

// Sobel gradient magnitude, normalized to 0..1. Used to pull a thin outline
// out of a filled shape instead of rendering it as a solid block.
export function sobelEdges(buf, width, height) {
  const at = (x, y) => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return buf[cy * width + cx];
  };

  const out = new Float32Array(width * height);
  let maxMagnitude = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = -at(x - 1, y - 1) + at(x + 1, y - 1)
        - 2 * at(x - 1, y) + 2 * at(x + 1, y)
        - at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
        + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      out[y * width + x] = magnitude;
      if (magnitude > maxMagnitude) maxMagnitude = magnitude;
    }
  }

  if (maxMagnitude > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= maxMagnitude;
  }

  return out;
}

async function loadSource(imagePath) {
  const { data, info } = await sharp(imagePath)
    .blur(SOURCE_BLUR_SIGMA)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const pixelCount = width * height;

  const luminance = new Float32Array(pixelCount);
  const alpha = new Float32Array(pixelCount);
  let luminanceSum = 0;

  for (let p = 0, i = 0; p < pixelCount; p++, i += channels) {
    const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    luminance[p] = l;
    alpha[p] = data[i + 3] / 255;
    luminanceSum += l;
  }

  const isLightBackground = luminanceSum / pixelCount > LIGHT_BACKGROUND_THRESHOLD;

  let ink;
  if (isLightBackground) {
    // Filled shape on a light background: invert to dark-shape-as-ink, then
    // extract just the boundary as a thin outline instead of a solid block.
    const inverted = new Float32Array(pixelCount);
    for (let p = 0; p < pixelCount; p++) inverted[p] = (1 - luminance[p]) * alpha[p];
    ink = sobelEdges(inverted, width, height);
  } else {
    ink = new Float32Array(pixelCount);
    for (let p = 0; p < pixelCount; p++) ink[p] = luminance[p] * alpha[p];
  }

  const ramp = isLightBackground ? RAMP_OUTLINE : RAMP_FILL;
  // A Sobel outline is already continuous at source resolution, so the
  // gap-bridging dilate below would only spread it into a thicker band.
  // Direct mode (sparse bright strokes) still needs it to stay connected.
  const useDilate = !isLightBackground;
  return { ink, width, height, ramp, useDilate };
}

export function sampleCellMax(source, xStart, xEnd, yStart, yEnd) {
  const { ink, width, height } = source;

  const x0 = Math.min(xStart, width - 1);
  const x1 = Math.max(Math.min(xEnd, width), x0 + 1);
  const y0 = Math.min(yStart, height - 1);
  const y1 = Math.max(Math.min(yEnd, height), y0 + 1);

  let peak = 0;
  for (let y = y0; y < y1; y++) {
    const rowOffset = y * width;
    for (let x = x0; x < x1; x++) {
      const value = ink[rowOffset + x];
      if (value > peak) peak = value;
    }
  }

  return peak;
}

export function buildCoverageGrid(source, columns, rows) {
  const cellW = source.width / columns;
  const cellH = source.height / rows;
  const grid = new Float32Array(columns * rows);

  for (let row = 0; row < rows; row++) {
    const yStart = Math.floor(row * cellH);
    const yEnd = Math.floor((row + 1) * cellH);
    for (let col = 0; col < columns; col++) {
      const xStart = Math.floor(col * cellW);
      const xEnd = Math.floor((col + 1) * cellW);
      grid[row * columns + col] = sampleCellMax(source, xStart, xEnd, yStart, yEnd);
    }
  }

  return grid;
}

export function dilateGrid(grid, columns, rows) {
  const dilated = new Float32Array(columns * rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      let peak = grid[row * columns + col];
      for (let dy = -1; dy <= 1; dy++) {
        const y = row + dy;
        if (y < 0 || y >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const x = col + dx;
          if (x < 0 || x >= columns) continue;
          const weight = dx !== 0 && dy !== 0 ? DILATE_DIAGONAL_WEIGHT : DILATE_ORTHOGONAL_WEIGHT;
          const value = grid[y * columns + x] * weight;
          if (value > peak) peak = value;
        }
      }
      dilated[row * columns + col] = peak;
    }
  }

  return dilated;
}

export function renderFrame(source, columns, rows) {
  const raw = buildCoverageGrid(source, columns, rows);
  const grid = source.useDilate ? dilateGrid(raw, columns, rows) : raw;
  const lines = new Array(rows);

  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < columns; col++) {
      const value = grid[row * columns + col];
      const luminance = value <= NOISE_FLOOR
        ? 0
        : Math.pow((value - NOISE_FLOOR) / (1 - NOISE_FLOOR), CONTRAST_GAMMA);
      line += source.ramp[Math.min(source.ramp.length - 1, Math.floor(luminance * source.ramp.length))];
    }
    lines[row] = `\x1b[97m${line}\x1b[0m`;
  }

  return lines;
}

export function fitToTerminal(source, termColumns, termRows) {
  // Always fill the terminal edge-to-edge horizontally; only cap rows to
  // what's available vertically (centering handles the leftover space).
  const columns = Math.max(1, termColumns);
  const aspect = source.height / source.width;
  const rows = Math.min(
    Math.max(1, termRows),
    Math.max(1, Math.round(columns * aspect * CHAR_ASPECT_CORRECTION))
  );

  return { columns, rows };
}

function draw(source) {
  const termColumns = process.stdout.columns || 80;
  const termRows = process.stdout.rows || 24;
  const { columns, rows } = fitToTerminal(source, termColumns, termRows);
  const lines = renderFrame(source, columns, rows);

  const topPad = Math.max(0, Math.floor((termRows - rows) / 2));
  const leftPad = ' '.repeat(Math.max(0, Math.floor((termColumns - columns) / 2)));

  const out = [];
  out.push('\x1b[2J\x1b[H'); // clear screen, cursor home
  for (let i = 0; i < topPad; i++) out.push('\n');
  for (const line of lines) out.push(leftPad + line + '\n');
  process.stdout.write(out.join(''));
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export async function runAsciify(imagePath) {
  const source = await loadSource(imagePath);
  const redraw = () => draw(source);
  const debouncedRedraw = debounce(redraw, RESIZE_DEBOUNCE_MS);

  process.stdout.write('\x1b[?25l'); // hide cursor
  redraw();
  process.stdout.on('resize', debouncedRedraw);

  const restore = () => {
    process.stdout.write('\x1b[?25h\x1b[0m\n');
    process.exit(0);
  };
  process.on('SIGINT', restore);
  process.on('SIGTERM', restore);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const target = process.argv[2] || `${process.env.HOME}/Downloads/CAFESWOOSH.png`;
  runAsciify(target).catch((err) => {
    process.stderr.write(`asciify failed: ${err.message}\n`);
    process.exit(1);
  });
}
