// ship
// designed and built by onyxpowered.
//
// The intro that plays once at the top of `ship startup`: a wave crosses
// the full width of the terminal, undulates, then flows off to the right,
// leaving "welcome to ship." behind it.
//
// The waveform is not a sine -- it's the real ribbon from the source
// artwork (Downloads/ribbon.svg, a 900x450 raster of a ribbon spanning
// x 44..860), sampled at 24 columns and split into the two things needed
// to animate it: where the ribbon's centerline sits, and how thick it is
// there. That's what gives the wave its character -- it's fat and low on
// one side, pinches almost shut, and opens back up -- instead of the even,
// mechanical swell a trig function would produce.
//
// Rendering is coverage-based rather than block-glyph: every cell is
// measured for how much of it the ribbon actually fills, and that fraction
// picks a character off a density ramp and a shade off a grayscale one. A
// cell the ribbon barely clips gets a '.'; one it fills completely gets a
// '@'. That's what makes the edges read as smooth curves at terminal
// resolution instead of a staircase of solid blocks.

// Sampled from the source artwork -- index 0 is the ribbon's left edge,
// index 23 its right edge, as fractions of the artwork's height.
const RIBBON_TOP = [
  0.2644, 0.3089, 0.3533, 0.3911, 0.4244, 0.4511, 0.4711, 0.4889,
  0.5022, 0.5089, 0.5133, 0.5133, 0.5111, 0.5044, 0.4956, 0.4844,
  0.4711, 0.4533, 0.4356, 0.4156, 0.3978, 0.3844, 0.3756, 0.3778,
];
const RIBBON_BOTTOM = [
  0.4822, 0.5111, 0.5378, 0.5578, 0.5711, 0.5800, 0.5844, 0.5822,
  0.5778, 0.5711, 0.5600, 0.5489, 0.5356, 0.5222, 0.5067, 0.4933,
  0.4800, 0.4689, 0.4600, 0.4533, 0.4511, 0.4533, 0.4644, 0.4822,
];

const CENTER = RIBBON_TOP.map((top, i) => (top + RIBBON_BOTTOM[i]) / 2);
const THICKNESS = RIBBON_TOP.map((top, i) => RIBBON_BOTTOM[i] - top);
const CENTER_MID = (Math.min(...CENTER) + Math.max(...CENTER)) / 2;
const CENTER_HALF_RANGE = (Math.max(...CENTER) - Math.min(...CENTER)) / 2;
const THICK_MIN = Math.min(...THICKNESS);
const THICK_MAX = Math.max(...THICKNESS);

// Sparse to dense. Deliberately not block glyphs -- punctuation and
// letterforms give far more usable levels between "empty" and "solid",
// which is the whole point of shading the wave rather than stamping it.
const RAMP = [' ', '.', ',', ':', ';', '=', '+', 'x', 'o', '%', '#', '@'];
// Grayscale escalates alongside the ramp so a barely-clipped cell is dim
// and a filled one is bright white -- density and luminance agreeing makes
// the edge falloff read as a soft edge rather than as noise.
const SHADE_FROM = 240;
const SHADE_TO = 255;

// How much screen one full traversal of the source ribbon occupies.
// Roughly a screen-width keeps the slope graceful; much less and the wave
// stops reading as a wave and starts reading as a diagonal stripe.
const WAVE_SPAN_FRACTION = 0.88;
// Peak excursion of the centerline, as a fraction of the terminal height.
const AMPLITUDE_FRACTION = 0.30;
// The source ribbon's thickness varies about 24x between its fat end and
// its waist -- faithful to the artwork, but tiled across a screen it reads
// as alternating blobs and wisps rather than as one ribbon. Remapping that
// range onto a narrow band keeps the taper (still thick where the artwork
// is thick, thin at the waist) while holding it to a ribbon throughout.
const RIBBON_MIN_FRACTION = 0.030;
const RIBBON_MAX_FRACTION = 0.115;
// Columns over which the leading and trailing ends taper off, so the wave
// arrives and departs instead of being clipped by a hard vertical edge.
const EDGE_FEATHER_COLS = 14;

const SUBCOLS_PER_CELL = 3;

const MIN_COLS = 48;
const MIN_ROWS = 12;
const MAX_CANVAS_ROWS = 26;

const FRAME_MS = 30;
const REACH_FRAMES = 30;
const WAVE_FRAMES = 26;
const DEPART_FRAMES = 30;
const PHASE_PER_FRAME = 0.018;
const FADE_FRAMES = 12;
const FADE_MS = 32;
const HOLD_MS = 560;

const WELCOME_TEXT = 'welcome to ship.';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE = '\x1b[2K';
const RESET = '\x1b[0m';
const FADE_FROM = 238;
const FADE_TO = 255;

// The source ribbon is a finite shape, but a wave has to keep going.
// Ping-ponging the parameter (forward, then backward, then forward again)
// makes it repeat seamlessly: sampling runs into its own mirror image, so
// the curve never jumps the way wrapping straight back to index 0 would.
function sampleCurve(curve, u) {
  let phase = u % 2;
  if (phase < 0) phase += 2;
  const t = phase > 1 ? 2 - phase : phase;
  const scaled = t * (curve.length - 1);
  const index = Math.floor(scaled);
  if (index >= curve.length - 1) return curve[curve.length - 1];
  return curve[index] + (curve[index + 1] - curve[index]) * (scaled - index);
}

function overlap(loA, hiA, loB, hiB) {
  return Math.max(0, Math.min(hiA, hiB) - Math.max(loA, loB));
}

// Smooth 0..1 falloff, used to feather the wave's two ends.
function feather(distance, width) {
  if (distance >= width) return 1;
  if (distance <= 0) return 0;
  const x = distance / width;
  return x * x * (3 - 2 * x);
}

export function renderWaveFrame({ cols, rows, phase, leftEdge, rightEdge }) {
  const spanCols = Math.max(8, cols * WAVE_SPAN_FRACTION);
  const midRow = (rows - 1) / 2;
  const lines = [];

  // Per-subcolumn band geometry is identical for every row, so it's
  // computed once per column instead of once per cell.
  const bands = new Array(cols);
  for (let col = 0; col < cols; col += 1) {
    if (col < leftEdge - EDGE_FEATHER_COLS || col > rightEdge) {
      bands[col] = null;
      continue;
    }
    const edgeFade = Math.min(
      feather(rightEdge - col, EDGE_FEATHER_COLS),
      feather(col - leftEdge + EDGE_FEATHER_COLS, EDGE_FEATHER_COLS),
    );
    if (edgeFade <= 0) {
      bands[col] = null;
      continue;
    }
    const sub = [];
    for (let s = 0; s < SUBCOLS_PER_CELL; s += 1) {
      const x = col + (s + 0.5) / SUBCOLS_PER_CELL;
      const u = x / spanCols - phase;
      const swing = (sampleCurve(CENTER, u) - CENTER_MID) / CENTER_HALF_RANGE;
      const center = midRow + swing * AMPLITUDE_FRACTION * rows;
      const taper = (sampleCurve(THICKNESS, u) - THICK_MIN) / (THICK_MAX - THICK_MIN);
      const half = ((RIBBON_MIN_FRACTION + taper * (RIBBON_MAX_FRACTION - RIBBON_MIN_FRACTION)) * rows) / 2;
      sub.push({ lo: center - half, hi: center + half });
    }
    bands[col] = { sub, edgeFade };
  }

  for (let row = 0; row < rows; row += 1) {
    let line = '';
    let lastShade = -1;
    let trailingBlanks = 0;
    for (let col = 0; col < cols; col += 1) {
      const band = bands[col];
      let coverage = 0;
      if (band) {
        let sum = 0;
        for (const { lo, hi } of band.sub) sum += overlap(row, row + 1, lo, hi);
        coverage = (sum / SUBCOLS_PER_CELL) * band.edgeFade;
      }
      const level = Math.min(RAMP.length - 1, Math.floor(coverage * RAMP.length));
      const glyph = RAMP[level];
      if (glyph === ' ') {
        trailingBlanks += 1;
        continue;
      }
      if (trailingBlanks > 0) {
        line += ' '.repeat(trailingBlanks);
        trailingBlanks = 0;
      }
      const shade = Math.round(SHADE_FROM + ((SHADE_TO - SHADE_FROM) * level) / (RAMP.length - 1));
      if (shade !== lastShade) {
        line += `\x1b[38;5;${shade}m`;
        lastShade = shade;
      }
      line += glyph;
    }
    if (lastShade !== -1) line += RESET;
    lines.push(line);
  }
  return lines;
}

function centeredLine(text, cols, color) {
  const pad = Math.max(0, Math.floor((cols - text.length) / 2));
  return `${' '.repeat(pad)}${color}${text}${RESET}`;
}

export function shouldAnimate(stream = process.stdout, env = process.env) {
  if (!stream.isTTY) return false;
  if (env.CI) return false;
  if (env.SHIP_NO_INTRO) return false;
  return (stream.columns ?? 0) >= MIN_COLS && (stream.rows ?? 0) >= MIN_ROWS;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function playWelcome({ stream = process.stdout, sleep = defaultSleep } = {}) {
  const cols = stream.columns;
  // Leave the bottom line free so the prompt that follows doesn't force a
  // scroll the moment the intro finishes.
  const rows = Math.max(MIN_ROWS, Math.min(MAX_CANVAS_ROWS, stream.rows - 1));

  let skipped = false;
  const stdin = process.stdin;
  const canSkip = Boolean(stdin.isTTY);
  const wasRaw = stdin.isRaw ?? false;
  const onKey = () => {
    skipped = true;
  };
  if (canSkip) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onKey);
  }

  stream.write(HIDE_CURSOR);
  stream.write('\n'.repeat(rows));

  function paint(lines) {
    let out = `\x1b[${rows}A`;
    for (const line of lines) out += `${CLEAR_LINE}${line}\n`;
    stream.write(out);
  }

  try {
    let phase = 0;
    const feathered = cols + EDGE_FEATHER_COLS;

    // Act one: the wave reaches across, its leading edge sweeping right.
    for (let frame = 0; frame <= REACH_FRAMES && !skipped; frame += 1) {
      const rightEdge = (feathered * frame) / REACH_FRAMES;
      paint(renderWaveFrame({ cols, rows, phase, leftEdge: 0, rightEdge }));
      phase += PHASE_PER_FRAME;
      await sleep(FRAME_MS);
    }

    // Act two: full width, waving in place.
    for (let frame = 0; frame < WAVE_FRAMES && !skipped; frame += 1) {
      paint(renderWaveFrame({ cols, rows, phase, leftEdge: 0, rightEdge: feathered }));
      phase += PHASE_PER_FRAME;
      await sleep(FRAME_MS);
    }

    // Act three: the back of the wave follows it off to the right.
    for (let frame = 0; frame <= DEPART_FRAMES && !skipped; frame += 1) {
      const leftEdge = (feathered * frame) / DEPART_FRAMES;
      paint(renderWaveFrame({ cols, rows, phase, leftEdge, rightEdge: feathered }));
      phase += PHASE_PER_FRAME;
      await sleep(FRAME_MS);
    }

    const blank = new Array(rows).fill('');
    const textRow = Math.floor((rows - 1) / 2);
    for (let step = skipped ? FADE_FRAMES : 0; step <= FADE_FRAMES; step += 1) {
      const shade = Math.round(FADE_FROM + ((FADE_TO - FADE_FROM) * step) / FADE_FRAMES);
      const lines = [...blank];
      lines[textRow] = centeredLine(WELCOME_TEXT, cols, `\x1b[38;5;${shade}m`);
      paint(lines);
      if (!skipped) await sleep(FADE_MS);
    }
    await sleep(skipped ? 0 : HOLD_MS);
  } finally {
    if (canSkip) {
      stdin.removeListener('data', onKey);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    }
    stream.write(SHOW_CURSOR);
  }
}

// Plays the intro when the terminal can actually show it, and does nothing
// at all when it can't (piped output, CI, a window too small) -- the
// startup flow itself must not depend on any of this.
export async function playWelcomeIfSupported(options = {}) {
  if (!shouldAnimate(options.stream ?? process.stdout)) return false;
  await playWelcome(options);
  return true;
}
