const SOURCE = 'https://radio.arinc.net/pacific/';

function htmlToText(markup) {
  return markup
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&rarr;|&#8594;/gi, '→')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseValid(text) {
  const m = text.match(/Pacific\s+HF\s+Frequency\s+Assignments\s+Valid\s+from\s+([A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{4}Z)/i);
  if (!m) throw new Error('Valid from not found');
  const raw = m[1].replace(/\s+/g, ' ').trim();
  const parts = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{2})(\d{2})Z$/);
  if (!parts) throw new Error('Invalid validity format');
  const months = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
  const month = months[parts[1]];
  if (month === undefined) throw new Error('Unknown month');
  const dt = new Date(Date.UTC(Number(parts[3]), month, Number(parts[2]), Number(parts[4]), Number(parts[5])));
  return { raw, iso: dt.toISOString(), ms: dt.getTime() };
}

function parsePair(text, labelRegex) {
  const m = text.match(new RegExp(labelRegex + '\\s+Air\\s+Traffic\\s+Control\\s+(\\d{4,5})\\s*kHz\\s+(\\d{4,5})\\s*kHz', 'i'));
  if (!m) throw new Error('Frequency pair not found');
  return { primary: Number(m[1]), secondary: Number(m[2]) };
}

async function fetchCandidate(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CrewPortal/5.7.6)',
      'Accept': 'text/html,application/xhtml+xml',
      'Cache-Control': 'no-cache, no-store, max-age=0',
      'Pragma': 'no-cache'
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  const text = htmlToText(await response.text());
  const valid = parseValid(text);
  return {
    source: SOURCE,
    validFrom: valid.raw,
    validFromUtc: valid.iso,
    validMs: valid.ms,
    fetchedAtUtc: new Date().toISOString(),
    northAmericaAsia: parsePair(text, 'North\\s+America\\s*(?:→|->|to)\\s*Asia'),
    alaskaNorthPacific: parsePair(text, 'Alaska/North\\s+Pacific\\s*\\(West\\s+of\\s+150W\\)')
  };
}

async function getArinc(request, env, ctx) {
  const now = new Date();
  // New assignments are expected on each UTC hour; after minute 05 use that hour's slot.
  const slot = new Date(now.getTime() - 5 * 60 * 1000);
  slot.setUTCMinutes(0, 0, 0);
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = '/api/arinc-cache';
  cacheUrl.search = `slot=${slot.toISOString()}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const stamp = Date.now();
  const urls = [
    SOURCE + `?crewportal=${stamp}`,
    SOURCE + `index.html?crewportal=${stamp}`,
    SOURCE
  ];
  const settled = await Promise.allSettled(urls.map(fetchCandidate));
  const valid = settled.filter(x => x.status === 'fulfilled').map(x => x.value);
  if (!valid.length) {
    const fallback = await env.ASSETS.fetch(new Request(new URL('/data/arinc.json', request.url)));
    return new Response(await fallback.text(), {
      status: fallback.ok ? 200 : 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-arinc-source': 'fallback' }
    });
  }
  valid.sort((a, b) => b.validMs - a.validMs);
  const best = { ...valid[0] };
  delete best.validMs;
  const response = new Response(JSON.stringify(best), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3300',
      'x-arinc-source': 'live'
    }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/arinc') return getArinc(request, env, ctx);
    return env.ASSETS.fetch(request);
  }
};
