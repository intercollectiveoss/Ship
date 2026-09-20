// ship
// designed and built by onyxpowered.
//
// Shared CLI presentation: a square glyph, colored by state, used tastefully
// as a line selector -- gray for system, amber for warning, red for error,
// green for success, white as the single moving cursor in Select.js's
// arrow-key picker. Replaces raw JSON dumps with clean, readable output.

const SQUARE = '■'; // ■

const COLOR = {
  gray: '\x1b[38;5;244m',
  amber: '\x1b[38;5;215m',
  red: '\x1b[38;5;203m',
  green: '\x1b[38;5;114m',
  white: '\x1b[38;5;255m',
  reset: '\x1b[0m',
};

function tagged(color) {
  return `${color}${SQUARE}${COLOR.reset}`;
}

export const tags = {
  system: tagged(COLOR.gray),
  warning: tagged(COLOR.amber),
  error: tagged(COLOR.red),
  success: tagged(COLOR.green),
  cursor: tagged(COLOR.white),
};

export function system(message) {
  return `${tags.system} ${message}`;
}

export function warning(message) {
  return `${tags.warning} ${message}`;
}

export function error(message) {
  return `${tags.error} ${message}`;
}

export function success(message) {
  return `${tags.success} ${message}`;
}

export function printSystem(message) {
  console.log(system(message));
}

export function printWarning(message) {
  console.log(warning(message));
}

export function printError(message) {
  console.error(error(message));
}

export function printSuccess(message) {
  console.log(success(message));
}

// A clean input field: a gray selector, the label, a colon, then the cursor.
export function field(label) {
  return `${tags.system} ${label}: `;
}

function humanizeKey(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

function formatScalar(value) {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) {
    return value.length === 0 ? '(none)' : value.map(formatScalar).join(', ');
  }
  return String(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Renders a plain result object as clean, indented lines instead of a raw
// JSON dump, e.g. { appName: 'demo', port: 3000 } becomes:
//   ■ app name: demo
//   ■ port: 3000
export function formatResult(result, depth = 0) {
  const indent = '  '.repeat(depth);
  const lines = [];
  for (const [key, value] of Object.entries(result)) {
    const label = humanizeKey(key);
    if (isPlainObject(value)) {
      lines.push(`${indent}${tags.system} ${label}:`);
      lines.push(formatResult(value, depth + 1));
    } else {
      lines.push(`${indent}${tags.system} ${label}: ${formatScalar(value)}`);
    }
  }
  return lines.join('\n');
}
