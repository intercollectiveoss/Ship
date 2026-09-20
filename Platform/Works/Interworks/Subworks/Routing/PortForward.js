// ship
// designed and built by onyxpowered.

import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

const NAT_PMP_PORT = 5351;
const SSDP_MULTICAST_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SSDP_SEARCH_TARGET = 'urn:schemas-upnp-org:device:InternetGatewayDevice:1';

export function localIPv4Address() {
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}

export function guessGatewayHost(localAddress = localIPv4Address()) {
  if (!localAddress) return null;
  const parts = localAddress.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
}

function sendUdpAndAwaitReply(socket, message, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners('message');
      reject(new Error('timed out waiting for a reply'));
    }, timeoutMs);

    socket.once('message', (reply, rinfo) => {
      clearTimeout(timer);
      resolve({ reply, rinfo });
    });

    socket.send(message, port, host, (error) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

export function encodeNatPmpMapRequest({ protocol = 'tcp', internalPort, externalPort = internalPort, lifetimeSeconds = 3600 }) {
  const opcode = protocol === 'udp' ? 1 : 2;
  const buffer = Buffer.alloc(12);
  buffer.writeUInt8(0, 0);
  buffer.writeUInt8(opcode, 1);
  buffer.writeUInt16BE(0, 2);
  buffer.writeUInt16BE(internalPort, 4);
  buffer.writeUInt16BE(externalPort, 6);
  buffer.writeUInt32BE(lifetimeSeconds, 8);
  return buffer;
}

export function decodeNatPmpMapResponse(buffer) {
  if (buffer.length < 16) {
    throw new Error('NAT-PMP response too short');
  }
  return {
    version: buffer.readUInt8(0),
    opcode: buffer.readUInt8(1),
    resultCode: buffer.readUInt16BE(2),
    secondsSinceEpoch: buffer.readUInt32BE(4),
    internalPort: buffer.readUInt16BE(8),
    externalPort: buffer.readUInt16BE(10),
    lifetimeSeconds: buffer.readUInt32BE(12),
  };
}

export async function requestNatPmpMapping({
  gatewayHost = guessGatewayHost(),
  protocol = 'tcp',
  internalPort,
  externalPort = internalPort,
  lifetimeSeconds = 3600,
  timeoutMs = 2000,
  gatewayPort = NAT_PMP_PORT,
  createDgramSocket = () => createSocket('udp4'),
}) {
  if (!gatewayHost) {
    throw new Error('requestNatPmpMapping could not determine a gateway host');
  }
  const socket = createDgramSocket();
  try {
    const request = encodeNatPmpMapRequest({ protocol, internalPort, externalPort, lifetimeSeconds });
    const { reply } = await sendUdpAndAwaitReply(socket, request, gatewayHost, gatewayPort, timeoutMs);
    const response = decodeNatPmpMapResponse(reply);
    if (response.resultCode !== 0) {
      throw new Error(`NAT-PMP mapping failed with result code ${response.resultCode}`);
    }
    return response;
  } finally {
    socket.close();
  }
}

function parseSsdpLocation(raw) {
  const match = /^location:\s*(.+)$/im.exec(raw.toString('utf8'));
  return match ? match[1].trim() : null;
}

export async function discoverUpnpGatewayLocation({
  searchTarget = SSDP_SEARCH_TARGET,
  multicastAddress = SSDP_MULTICAST_ADDRESS,
  multicastPort = SSDP_PORT,
  timeoutMs = 2000,
  createDgramSocket = () => createSocket('udp4'),
}) {
  const socket = createDgramSocket();
  try {
    const request = Buffer.from(
      [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${multicastAddress}:${multicastPort}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        `ST: ${searchTarget}`,
        '',
        '',
      ].join('\r\n'),
    );
    const { reply } = await sendUdpAndAwaitReply(socket, request, multicastAddress, multicastPort, timeoutMs);
    const location = parseSsdpLocation(reply);
    if (!location) {
      throw new Error('SSDP response did not include a LOCATION header');
    }
    return location;
  } finally {
    socket.close();
  }
}

function extractTag(xml, tagName) {
  const match = new RegExp(`<${tagName}>([^<]*)</${tagName}>`, 'i').exec(xml);
  return match ? match[1].trim() : null;
}

function findWanConnectionService(xml) {
  const serviceBlocks = xml.match(/<service>[\s\S]*?<\/service>/gi) ?? [];
  for (const block of serviceBlocks) {
    const serviceType = extractTag(block, 'serviceType');
    if (serviceType && /WANIPConnection|WANPPPConnection/.test(serviceType)) {
      return {
        serviceType,
        controlUrl: extractTag(block, 'controlURL'),
      };
    }
  }
  return null;
}

export async function fetchUpnpControlUrl(deviceDescriptionUrl, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(deviceDescriptionUrl);
  if (!response.ok) {
    throw new Error(`failed to fetch UPnP device description: ${response.status}`);
  }
  const xml = await response.text();
  const service = findWanConnectionService(xml);
  if (!service || !service.controlUrl) {
    throw new Error('no WANIPConnection/WANPPPConnection service found in UPnP device description');
  }
  const urlBase = extractTag(xml, 'URLBase');
  const base = new URL(deviceDescriptionUrl);
  const resolved = new URL(service.controlUrl, urlBase ?? `${base.protocol}//${base.host}`);
  return { serviceType: service.serviceType, controlUrl: resolved.toString() };
}

function buildAddPortMappingSoapBody({ serviceType, externalPort, internalPort, internalClient, protocol, description, leaseDuration }) {
  return [
    '<?xml version="1.0"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<s:Body>',
    `<u:AddPortMapping xmlns:u="${serviceType}">`,
    '<NewRemoteHost></NewRemoteHost>',
    `<NewExternalPort>${externalPort}</NewExternalPort>`,
    `<NewProtocol>${protocol.toUpperCase()}</NewProtocol>`,
    `<NewInternalPort>${internalPort}</NewInternalPort>`,
    `<NewInternalClient>${internalClient}</NewInternalClient>`,
    '<NewEnabled>1</NewEnabled>',
    `<NewPortMappingDescription>${description}</NewPortMappingDescription>`,
    `<NewLeaseDuration>${leaseDuration}</NewLeaseDuration>`,
    '</u:AddPortMapping>',
    '</s:Body>',
    '</s:Envelope>',
  ].join('');
}

export async function requestUpnpMapping({
  controlUrl,
  serviceType,
  internalPort,
  externalPort = internalPort,
  internalClient = localIPv4Address(),
  protocol = 'tcp',
  description = 'ship',
  leaseDuration = 0,
  fetchImpl = fetch,
}) {
  if (!internalClient) {
    throw new Error('requestUpnpMapping could not determine a local IPv4 address to map to');
  }
  const body = buildAddPortMappingSoapBody({ serviceType, externalPort, internalPort, internalClient, protocol, description, leaseDuration });
  const response = await fetchImpl(controlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset="utf-8"',
      soapaction: `"${serviceType}#AddPortMapping"`,
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`UPnP AddPortMapping failed: ${response.status} ${text}`);
  }
  return { ok: true, raw: text };
}

export async function attemptUpnpPortForward(port, {
  protocol = 'tcp',
  fetchImpl = fetch,
  createDgramSocket,
  timeoutMs = 2000,
  searchTarget,
  multicastAddress,
  multicastPort,
} = {}) {
  const location = await discoverUpnpGatewayLocation({
    timeoutMs,
    createDgramSocket,
    ...(searchTarget ? { searchTarget } : {}),
    ...(multicastAddress ? { multicastAddress } : {}),
    ...(multicastPort ? { multicastPort } : {}),
  });
  const { serviceType, controlUrl } = await fetchUpnpControlUrl(location, { fetchImpl });
  await requestUpnpMapping({ controlUrl, serviceType, internalPort: port, protocol, fetchImpl });
  return { mechanism: 'upnp', port };
}

export async function attemptNatPmpPortForward(port, { protocol = 'tcp', timeoutMs = 2000, createDgramSocket, gatewayHost, gatewayPort } = {}) {
  const response = await requestNatPmpMapping({
    internalPort: port,
    protocol,
    timeoutMs,
    createDgramSocket,
    gatewayHost,
    ...(gatewayPort ? { gatewayPort } : {}),
  });
  return { mechanism: 'nat-pmp', port: response.externalPort };
}

export async function attemptPortForward(port, options = {}) {
  try {
    return await attemptUpnpPortForward(port, options);
  } catch (upnpError) {
    try {
      return await attemptNatPmpPortForward(port, options);
    } catch (natPmpError) {
      return {
        mechanism: null,
        port,
        error: `UPnP failed (${upnpError.message}); NAT-PMP failed (${natPmpError.message})`,
      };
    }
  }
}

export function manualPortForwardInstructions(port, protocol = 'TCP') {
  return `ship could not automatically configure your router. Forward external ${protocol} port ${port} to this machine's local IP address (${localIPv4Address() ?? 'find it in your OS network settings'}) in your router's port-forwarding settings, then try again.`;
}
