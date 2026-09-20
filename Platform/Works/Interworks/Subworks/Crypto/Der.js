// ship
// designed and built by onyxpowered.

export const TAG_BOOLEAN = 0x01;
export const TAG_INTEGER = 0x02;
export const TAG_BIT_STRING = 0x03;
export const TAG_OCTET_STRING = 0x04;
export const TAG_NULL = 0x05;
export const TAG_OID = 0x06;
export const TAG_UTF8_STRING = 0x0c;
export const TAG_PRINTABLE_STRING = 0x13;
export const TAG_IA5_STRING = 0x16;
export const TAG_UTC_TIME = 0x17;
export const TAG_GENERALIZED_TIME = 0x18;
export const TAG_SEQUENCE = 0x30;
export const TAG_SET = 0x31;

function concatBuffers(buffers) {
  return Buffer.concat(buffers.map((buffer) => (Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))));
}

export function encodeLength(length) {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function encodeTlv(tag, content) {
  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), encodeLength(contentBuffer.length), contentBuffer]);
}

export function encodeSequence(...children) {
  return encodeTlv(TAG_SEQUENCE, concatBuffers(children));
}

export function encodeSet(...children) {
  return encodeTlv(TAG_SET, concatBuffers(children));
}

export function encodeSetOf(children) {
  const sorted = [...children].map((child) => (Buffer.isBuffer(child) ? child : Buffer.from(child)));
  sorted.sort(Buffer.compare);
  return encodeTlv(TAG_SET, Buffer.concat(sorted));
}

export function encodeBoolean(value) {
  return encodeTlv(TAG_BOOLEAN, Buffer.from([value ? 0xff : 0x00]));
}

export function encodeNull() {
  return encodeTlv(TAG_NULL, Buffer.alloc(0));
}

export function encodeInteger(value) {
  let magnitude;
  if (Buffer.isBuffer(value)) {
    magnitude = value;
    let offset = 0;
    while (offset < magnitude.length - 1 && magnitude[offset] === 0x00) offset += 1;
    magnitude = magnitude.subarray(offset);
  } else {
    let big = typeof value === 'bigint' ? value : BigInt(value);
    if (big < 0n) {
      throw new Error('encodeInteger does not support negative values');
    }
    if (big === 0n) {
      magnitude = Buffer.from([0x00]);
    } else {
      const bytes = [];
      while (big > 0n) {
        bytes.unshift(Number(big & 0xffn));
        big >>= 8n;
      }
      magnitude = Buffer.from(bytes);
    }
  }
  if (magnitude.length === 0) {
    magnitude = Buffer.from([0x00]);
  }
  if (magnitude[0] & 0x80) {
    magnitude = Buffer.concat([Buffer.from([0x00]), magnitude]);
  }
  return encodeTlv(TAG_INTEGER, magnitude);
}

export function encodeBitString(content, unusedBits = 0) {
  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return encodeTlv(TAG_BIT_STRING, Buffer.concat([Buffer.from([unusedBits]), contentBuffer]));
}

export function encodeOctetString(content) {
  return encodeTlv(TAG_OCTET_STRING, content);
}

export function encodeUtf8String(text) {
  return encodeTlv(TAG_UTF8_STRING, Buffer.from(text, 'utf8'));
}

export function encodePrintableString(text) {
  return encodeTlv(TAG_PRINTABLE_STRING, Buffer.from(text, 'ascii'));
}

export function encodeIa5String(text) {
  return encodeTlv(TAG_IA5_STRING, Buffer.from(text, 'ascii'));
}

export function encodeOid(dotted) {
  const parts = dotted.split('.').map((part) => Number(part));
  if (parts.length < 2) {
    throw new Error(`invalid OID: ${dotted}`);
  }
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    if (part === 0) {
      bytes.push(0);
      continue;
    }
    const chunk = [];
    let remaining = part;
    while (remaining > 0) {
      chunk.unshift(remaining & 0x7f);
      remaining = Math.floor(remaining / 128);
    }
    for (let i = 0; i < chunk.length - 1; i += 1) {
      chunk[i] |= 0x80;
    }
    bytes.push(...chunk);
  }
  return encodeTlv(TAG_OID, Buffer.from(bytes));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function encodeUtcTime(date) {
  const year = pad2(date.getUTCFullYear() % 100);
  const text = `${year}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
  return encodeTlv(TAG_UTC_TIME, Buffer.from(text, 'ascii'));
}

export function encodeGeneralizedTime(date) {
  const text = `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
  return encodeTlv(TAG_GENERALIZED_TIME, Buffer.from(text, 'ascii'));
}

export function encodeX509Time(date) {
  return date.getUTCFullYear() < 2050 ? encodeUtcTime(date) : encodeGeneralizedTime(date);
}

export function encodeContextConstructed(number, ...children) {
  return encodeTlv(0xa0 | number, concatBuffers(children));
}

export function encodeContextPrimitive(number, content) {
  return encodeTlv(0x80 | number, content);
}

class DerReader {
  constructor(buffer, offset = 0) {
    this.buffer = buffer;
    this.offset = offset;
  }

  readByte() {
    const value = this.buffer[this.offset];
    this.offset += 1;
    return value;
  }

  readLength() {
    const first = this.readByte();
    if ((first & 0x80) === 0) {
      return first;
    }
    const byteCount = first & 0x7f;
    let length = 0;
    for (let i = 0; i < byteCount; i += 1) {
      length = length * 256 + this.readByte();
    }
    return length;
  }

  readTlv() {
    const tag = this.readByte();
    const length = this.readLength();
    const content = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return { tag, content };
  }

  atEnd() {
    return this.offset >= this.buffer.length;
  }
}

export function decodeTlv(buffer, offset = 0) {
  const reader = new DerReader(buffer, offset);
  const { tag, content } = reader.readTlv();
  return { tag, content, nextOffset: reader.offset };
}

export function decodeSequence(buffer) {
  const { tag, content } = decodeTlv(buffer);
  if (tag !== TAG_SEQUENCE) {
    throw new Error(`expected SEQUENCE, got tag 0x${tag.toString(16)}`);
  }
  const reader = new DerReader(content, 0);
  const items = [];
  while (!reader.atEnd()) {
    items.push(reader.readTlv());
  }
  return items;
}

export function decodeInteger(content) {
  let value = 0n;
  for (const byte of content) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}
