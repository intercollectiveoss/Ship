// ship
// designed and built by onyxpowered.

export const PROTOCOL_VERSION = 1;

export const MESSAGE_TYPES = Object.freeze({
  HELLO: 'hello',
  HELLO_ACK: 'helloAck',
  PING: 'ping',
  PONG: 'pong',
  REQUEST: 'request',
  RESPONSE: 'response',
  ERROR: 'error',
});

const KNOWN_TYPES = new Set(Object.values(MESSAGE_TYPES));

export function encodeMessage(message) {
  return JSON.stringify(message);
}

export function decodeMessage(raw) {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const message = JSON.parse(text);
  if (typeof message.type !== 'string' || !KNOWN_TYPES.has(message.type)) {
    throw new Error(`unknown tunnel message type: ${message.type}`);
  }
  return message;
}

function encodeBody(body) {
  if (body === null || body === undefined) return null;
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return buffer.toString('base64');
}

export function decodeBody(message) {
  return message.body ? Buffer.from(message.body, 'base64') : Buffer.alloc(0);
}

export function createHelloMessage({ token, appSlug, mode }) {
  return { type: MESSAGE_TYPES.HELLO, version: PROTOCOL_VERSION, token, appSlug, mode };
}

export function createHelloAckMessage({ previewUrl = null, sessionId = null } = {}) {
  return { type: MESSAGE_TYPES.HELLO_ACK, previewUrl, sessionId };
}

export function createPingMessage() {
  return { type: MESSAGE_TYPES.PING };
}

export function createPongMessage() {
  return { type: MESSAGE_TYPES.PONG };
}

export function createRequestMessage({ id, method, url, headers = {}, body = null }) {
  return { type: MESSAGE_TYPES.REQUEST, id, method, url, headers, body: encodeBody(body) };
}

export function createResponseMessage({ id, statusCode, headers = {}, body = null }) {
  return { type: MESSAGE_TYPES.RESPONSE, id, statusCode, headers, body: encodeBody(body) };
}

export function createErrorMessage({ id = null, message }) {
  return { type: MESSAGE_TYPES.ERROR, id, message };
}
