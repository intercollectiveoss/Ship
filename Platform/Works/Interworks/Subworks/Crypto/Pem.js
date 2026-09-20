// ship
// designed and built by onyxpowered.

const LINE_LENGTH = 64;

export function encodePem(label, derBuffer) {
  const base64 = derBuffer.toString('base64');
  const lines = [];
  for (let offset = 0; offset < base64.length; offset += LINE_LENGTH) {
    lines.push(base64.slice(offset, offset + LINE_LENGTH));
  }
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

export function decodePem(pemText, expectedLabel = null) {
  const blocks = decodePemChain(pemText, expectedLabel);
  if (blocks.length === 0) {
    throw new Error('no PEM block found');
  }
  return blocks[0];
}

export function decodePemChain(pemText, expectedLabel = null) {
  const text = Buffer.isBuffer(pemText) ? pemText.toString('utf8') : pemText;
  const pattern = /-----BEGIN ([A-Z0-9 ]+)-----\r?\n([\s\S]*?)-----END \1-----/g;
  const blocks = [];
  let match = pattern.exec(text);
  while (match !== null) {
    const label = match[1];
    if (expectedLabel === null || label === expectedLabel) {
      const base64 = match[2].replace(/\r?\n/g, '');
      blocks.push({ label, der: Buffer.from(base64, 'base64') });
    }
    match = pattern.exec(text);
  }
  return blocks;
}
