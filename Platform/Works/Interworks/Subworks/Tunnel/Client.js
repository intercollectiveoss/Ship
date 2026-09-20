// ship
// designed and built by onyxpowered.

import { EventEmitter } from 'node:events';
import WebSocket from '../Vendors/Ws/index.js';
import {
  MESSAGE_TYPES,
  encodeMessage,
  decodeMessage,
  decodeBody,
  createHelloMessage,
  createPongMessage,
  createResponseMessage,
  createErrorMessage,
} from './Protocol.js';

const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30000;
const DEFAULT_BACKOFF_FACTOR = 2;

async function runRequestHandler(requestHandler, message) {
  try {
    const result = await requestHandler({
      id: message.id,
      method: message.method,
      url: message.url,
      headers: message.headers,
      body: decodeBody(message),
    });
    return createResponseMessage({
      id: message.id,
      statusCode: result.statusCode,
      headers: result.headers ?? {},
      body: result.body ?? null,
    });
  } catch (error) {
    return createErrorMessage({ id: message.id, message: error.message });
  }
}

export function createTunnelClient({
  url,
  token,
  appSlug,
  mode = 'preview',
  requestHandler,
  WebSocketImpl = WebSocket,
  reconnect = {},
}) {
  if (typeof requestHandler !== 'function') {
    throw new Error('createTunnelClient requires a requestHandler(request) function');
  }

  const emitter = new EventEmitter();
  const {
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    factor = DEFAULT_BACKOFF_FACTOR,
  } = reconnect;

  const state = {
    socket: null,
    connected: false,
    closed: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
  };

  function nextDelay() {
    const delay = Math.min(maxDelayMs, initialDelayMs * factor ** state.reconnectAttempts);
    state.reconnectAttempts += 1;
    return delay;
  }

  function scheduleReconnect() {
    if (state.closed) return;
    const delay = nextDelay();
    state.reconnectTimer = setTimeout(connect, delay);
    emitter.emit('reconnecting', { delayMs: delay, attempt: state.reconnectAttempts });
  }

  function send(message) {
    if (state.socket && state.socket.readyState === WebSocketImpl.OPEN) {
      state.socket.send(encodeMessage(message));
    }
  }

  async function handleMessage(raw) {
    let message;
    try {
      message = decodeMessage(raw);
    } catch {
      return;
    }

    if (message.type === MESSAGE_TYPES.PING) {
      send(createPongMessage());
      return;
    }

    if (message.type === MESSAGE_TYPES.REQUEST) {
      const response = await runRequestHandler(requestHandler, message);
      send(response);
      return;
    }

    emitter.emit(message.type, message);
    emitter.emit('message', message);
  }

  function connect() {
    if (state.closed) return;
    const socket = new WebSocketImpl(url);
    state.socket = socket;

    socket.on('open', () => {
      state.connected = true;
      state.reconnectAttempts = 0;
      send(createHelloMessage({ token, appSlug, mode }));
      emitter.emit('open');
    });

    socket.on('message', (data) => {
      handleMessage(data);
    });

    socket.on('close', () => {
      const wasConnected = state.connected;
      state.connected = false;
      if (wasConnected) {
        emitter.emit('close');
      }
      if (!state.closed) {
        scheduleReconnect();
      }
    });

    socket.on('error', (error) => {
      if (emitter.listenerCount('error') > 0) {
        emitter.emit('error', error);
      }
    });
  }

  connect();

  return Object.freeze({
    on: (event, listener) => emitter.on(event, listener),
    once: (event, listener) => emitter.once(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    isConnected: () => state.connected,
    reconnectAttempts: () => state.reconnectAttempts,
    close: () => {
      state.closed = true;
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
      }
      const socket = state.socket;
      if (!socket || socket.readyState === WebSocketImpl.CLOSED) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        socket.once('close', resolve);
        socket.close();
      });
    },
  });
}
