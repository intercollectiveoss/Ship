// ship
// designed and built by onyxpowered.

export async function acmeRequest(url, { method = 'GET', headers = {}, body = null, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { method, headers, body });
  const text = await response.text();
  let data = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return {
    status: response.status,
    headers: response.headers,
    data,
  };
}

export function nonceFromHeaders(headers) {
  return headers.get('replay-nonce');
}

export function locationFromHeaders(headers) {
  return headers.get('location');
}

export function linksFromHeaders(headers, relation) {
  const raw = headers.get('link');
  if (!raw) return [];
  const links = [];
  for (const part of raw.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?([^";]+)"?/.exec(part.trim());
    if (match && match[2] === relation) {
      links.push(match[1]);
    }
  }
  return links;
}
