// ship
// designed and built by onyxpowered.

import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import {
  encodeSequence,
  encodeSet,
  encodeInteger,
  encodeOid,
  encodeNull,
  encodeBoolean,
  encodeBitString,
  encodeOctetString,
  encodeUtf8String,
  encodePrintableString,
  encodeIa5String,
  encodeX509Time,
  encodeContextConstructed,
  encodeContextPrimitive,
  encodeTlv,
  decodeSequence,
} from './Der.js';
import { exportPublicKeySpkiDer, signatureAlgorithmForKey, signTbs, publicKeyFromPrivateKey } from './Keys.js';
import { encodePem, decodePem } from './Pem.js';

const OID_COMMON_NAME = '2.5.4.3';
const OID_COUNTRY = '2.5.4.6';
const OID_LOCALITY = '2.5.4.7';
const OID_STATE = '2.5.4.8';
const OID_ORGANIZATION = '2.5.4.10';
const OID_ORGANIZATIONAL_UNIT = '2.5.4.11';
const OID_EMAIL_ADDRESS = '1.2.840.113549.1.9.1';
const OID_EXTENSION_REQUEST = '1.2.840.113549.1.9.14';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_SUBJECT_KEY_IDENTIFIER = '2.5.29.14';
const OID_EXTENDED_KEY_USAGE = '2.5.29.37';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

const NAME_FIELDS = [
  ['CN', OID_COMMON_NAME, encodeUtf8String],
  ['C', OID_COUNTRY, encodePrintableString],
  ['ST', OID_STATE, encodeUtf8String],
  ['L', OID_LOCALITY, encodeUtf8String],
  ['O', OID_ORGANIZATION, encodeUtf8String],
  ['OU', OID_ORGANIZATIONAL_UNIT, encodeUtf8String],
  ['E', OID_EMAIL_ADDRESS, encodeIa5String],
];

export function buildName(fields = {}) {
  const rdns = [];
  for (const [key, oid, encodeString] of NAME_FIELDS) {
    const value = fields[key];
    if (value === undefined || value === null || value === '') continue;
    rdns.push(encodeSet(encodeSequence(encodeOid(oid), encodeString(value))));
  }
  return encodeSequence(...rdns);
}

export function randomSerialNumber() {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f;
  return bytes;
}

export function parseIpv6ToBytes(address) {
  const compressedIndex = address.indexOf('::');
  const head = compressedIndex === -1 ? address : address.slice(0, compressedIndex);
  const tail = compressedIndex === -1 ? '' : address.slice(compressedIndex + 2);
  const headGroups = head.length > 0 ? head.split(':') : [];
  const tailGroups = tail.length > 0 ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array(Math.max(missing, 0)).fill('0'), ...tailGroups];
  const bytes = Buffer.alloc(16);
  groups.forEach((group, index) => {
    bytes.writeUInt16BE(parseInt(group || '0', 16), index * 2);
  });
  return bytes;
}

function generalName(value) {
  const type = isIP(value);
  if (type === 4) {
    return encodeContextPrimitive(7, Buffer.from(value.split('.').map((part) => Number(part))));
  }
  if (type === 6) {
    return encodeContextPrimitive(7, parseIpv6ToBytes(value));
  }
  return encodeContextPrimitive(2, Buffer.from(value, 'ascii'));
}

export function buildSubjectAltNameExtension(altNames, critical = false) {
  const generalNames = encodeSequence(...altNames.map(generalName));
  const parts = [encodeOid(OID_SUBJECT_ALT_NAME)];
  if (critical) parts.push(encodeBoolean(true));
  parts.push(encodeOctetString(generalNames));
  return encodeSequence(...parts);
}

export function buildBasicConstraintsExtension({ isCA = false, pathLen = null } = {}) {
  const inner = [];
  if (isCA) inner.push(encodeBoolean(true));
  if (pathLen !== null) inner.push(encodeInteger(pathLen));
  const value = encodeSequence(...inner);
  return encodeSequence(encodeOid(OID_BASIC_CONSTRAINTS), encodeBoolean(true), encodeOctetString(value));
}

const KEY_USAGE_BITS = {
  digitalSignature: 0,
  keyEncipherment: 2,
  keyCertSign: 5,
  cRLSign: 6,
};

export function buildKeyUsageExtension(usages, critical = true) {
  let byte0 = 0;
  for (const usage of usages) {
    const bit = KEY_USAGE_BITS[usage];
    if (bit === undefined) throw new Error(`unknown key usage: ${usage}`);
    byte0 |= 1 << (7 - bit);
  }
  const content = encodeBitString(Buffer.from([byte0]), byte0 === 0 ? 0 : trailingZeroCount(byte0));
  const parts = [encodeOid(OID_KEY_USAGE)];
  if (critical) parts.push(encodeBoolean(true));
  parts.push(encodeOctetString(content));
  return encodeSequence(...parts);
}

function trailingZeroCount(byte) {
  let count = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    if ((byte & (1 << bit)) !== 0) break;
    count += 1;
  }
  return count;
}

export function buildExtendedKeyUsageExtension(oids) {
  const value = encodeSequence(...oids.map((oid) => encodeOid(oid)));
  return encodeSequence(encodeOid(OID_EXTENDED_KEY_USAGE), encodeOctetString(value));
}

export function buildSubjectKeyIdentifierExtension(publicKeySpkiDer) {
  const [, subjectPublicKeyBitString] = decodeSequence(publicKeySpkiDer);
  const keyBytes = subjectPublicKeyBitString.content.subarray(1);
  const digest = createHash('sha1').update(keyBytes).digest();
  const value = encodeOctetString(digest);
  return encodeSequence(encodeOid(OID_SUBJECT_KEY_IDENTIFIER), encodeOctetString(value));
}

export function buildExtensionRequestAttribute(extensions) {
  const extensionsSeq = encodeSequence(...extensions);
  return encodeSequence(encodeOid(OID_EXTENSION_REQUEST), encodeSet(extensionsSeq));
}

function algorithmIdentifier({ oid, isRsa }) {
  return isRsa ? encodeSequence(encodeOid(oid), encodeNull()) : encodeSequence(encodeOid(oid));
}

export function buildCsr({ privateKey, publicKey, commonName = null, altNames = [], subject = {} }) {
  const spkiDer = exportPublicKeySpkiDer(publicKey);
  const name = buildName({ CN: commonName, ...subject });
  const extensions = [];
  const allAltNames = commonName && !altNames.includes(commonName) ? [commonName, ...altNames] : altNames;
  if (allAltNames.length > 0) {
    extensions.push(buildSubjectAltNameExtension(allAltNames));
  }
  const attributes = extensions.length > 0
    ? encodeContextConstructed(0, buildExtensionRequestAttribute(extensions))
    : encodeContextConstructed(0);

  const certificationRequestInfo = encodeSequence(
    encodeInteger(0),
    name,
    spkiDer,
    attributes,
  );

  const alg = signatureAlgorithmForKey(publicKey);
  const signatureAlgorithm = algorithmIdentifier({ oid: alg.oid, isRsa: publicKey.asymmetricKeyType === 'rsa' });
  const signature = signTbs(privateKey, certificationRequestInfo);

  const csr = encodeSequence(
    certificationRequestInfo,
    signatureAlgorithm,
    encodeBitString(signature, 0),
  );

  return encodePem('CERTIFICATE REQUEST', csr);
}

export function buildCertificate({
  subjectPublicKey,
  subjectName,
  issuerName,
  issuerPrivateKey,
  serialNumber = randomSerialNumber(),
  notBefore = new Date(),
  notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  altNames = [],
  isCA = false,
  pathLen = null,
  keyUsage = isCA ? ['keyCertSign', 'cRLSign'] : ['digitalSignature', 'keyEncipherment'],
  extendedKeyUsage = isCA ? [] : [OID_SERVER_AUTH],
}) {
  const subjectSpkiDer = exportPublicKeySpkiDer(subjectPublicKey);
  const issuerPublicKey = publicKeyFromPrivateKey(issuerPrivateKey);
  const issuerAlg = signatureAlgorithmForKey(issuerPublicKey);
  const signatureAlgorithm = algorithmIdentifier({
    oid: issuerAlg.oid,
    isRsa: issuerPublicKey.asymmetricKeyType === 'rsa',
  });

  const extensions = [
    buildBasicConstraintsExtension({ isCA, pathLen }),
    buildKeyUsageExtension(keyUsage),
    buildSubjectKeyIdentifierExtension(subjectSpkiDer),
  ];
  if (extendedKeyUsage.length > 0) {
    extensions.push(buildExtendedKeyUsageExtension(extendedKeyUsage));
  }
  if (altNames.length > 0) {
    extensions.push(buildSubjectAltNameExtension(altNames));
  }

  const tbsCertificate = encodeSequence(
    encodeContextConstructed(0, encodeInteger(2)),
    encodeInteger(serialNumber),
    signatureAlgorithm,
    issuerName,
    encodeSequence(encodeX509Time(notBefore), encodeX509Time(notAfter)),
    subjectName,
    subjectSpkiDer,
    encodeContextConstructed(3, encodeSequence(...extensions)),
  );

  const signature = signTbs(issuerPrivateKey, tbsCertificate);

  const certificate = encodeSequence(
    tbsCertificate,
    signatureAlgorithm,
    encodeBitString(signature, 0),
  );

  return encodePem('CERTIFICATE', certificate);
}

export function parseCertificate(pem) {
  return new X509Certificate(pem);
}

function reencodeTlv(item) {
  return encodeTlv(item.tag, item.content);
}

const TBS_CERTIFICATE_SUBJECT_INDEX_WITH_VERSION = 5;

export function extractSubjectNameDer(certificatePem) {
  const { der } = decodePem(certificatePem, 'CERTIFICATE');
  const [tbsCertificateItem] = decodeSequence(der);
  const tbsItems = decodeSequence(reencodeTlv(tbsCertificateItem));
  const subject = tbsItems[TBS_CERTIFICATE_SUBJECT_INDEX_WITH_VERSION];
  return reencodeTlv(subject);
}
