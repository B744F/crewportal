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

async function fetchCandidate(candidate) {
  const response = await fetch(candidate.url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache, no-store, max-age=0',
      'Pragma': 'no-cache'
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = htmlToText(await response.text());
  const valid = parseValid(text);
  return {
    route: candidate.name,
    source: SOURCE,
    validFrom: valid.raw,
    validFromUtc: valid.iso,
    validMs: valid.ms,
    fetchedAtUtc: new Date().toISOString(),
    northAmericaAsia: parsePair(text, 'North\\s+America\\s*(?:→|->|to)\\s*Asia'),
    alaskaNorthPacific: parsePair(text, 'Alaska/North\\s+Pacific\\s*\\(West\\s+of\\s+150W\\)')
  };
}

function candidateRoutes(stamp) {
  const encoded = encodeURIComponent(SOURCE + `?crewportal=${stamp}`);
  return [
    { name: 'direct-query', url: SOURCE + `?crewportal=${stamp}` },
    { name: 'direct-index', url: SOURCE + `index.html?crewportal=${stamp}` },
    // Google Translate fetches the page through a separate network path and often
    // bypasses an upstream regional edge that is serving an older ARINC document.
    { name: 'google-translate', url: `https://radio-arinc-net.translate.goog/pacific/?_x_tr_sl=en&_x_tr_tl=en&_x_tr_hl=en&crewportal=${stamp}` },
    // Jina Reader is an independent fallback network path. The parser handles its
    // text/markdown response because the relevant table content remains intact.
    { name: 'jina-reader', url: `https://r.jina.ai/http://radio.arinc.net/pacific/?crewportal=${stamp}` },
    // AllOrigins is only a last-resort route; if unavailable it is simply ignored.
    { name: 'allorigins', url: `https://api.allorigins.win/raw?url=${encoded}` }
  ];
}

async function getArinc(request, env, ctx) {
  const now = new Date();
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
  const routes = candidateRoutes(stamp);
  const settled = await Promise.allSettled(routes.map(fetchCandidate));
  const successful = settled.filter(x => x.status === 'fulfilled').map(x => x.value);
  const diagnostics = settled.map((result, index) => ({
    route: routes[index].name,
    ok: result.status === 'fulfilled',
    validFromUtc: result.status === 'fulfilled' ? result.value.validFromUtc : null,
    error: result.status === 'rejected' ? String(result.reason?.message || result.reason) : null
  }));

  if (!successful.length) {
    const fallback = await env.ASSETS.fetch(new Request(new URL('/data/arinc.json', request.url)));
    const fallbackData = fallback.ok ? await fallback.json() : {};
    return Response.json({ ...fallbackData, syncMode: 'fallback', diagnostics }, {
      status: fallback.ok ? 200 : 502,
      headers: { 'cache-control': 'no-store', 'x-arinc-source': 'fallback' }
    });
  }

  successful.sort((a, b) => b.validMs - a.validMs);
  const selected = successful[0];
  const best = {
    source: selected.source,
    route: selected.route,
    syncMode: 'multi-route-live',
    validFrom: selected.validFrom,
    validFromUtc: selected.validFromUtc,
    fetchedAtUtc: selected.fetchedAtUtc,
    northAmericaAsia: selected.northAmericaAsia,
    alaskaNorthPacific: selected.alaskaNorthPacific,
    diagnostics
  };

  const response = Response.json(best, {
    headers: {
      'cache-control': 'public, max-age=0, s-maxage=3300',
      'x-arinc-source': selected.route
    }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}


const TDX_TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_API_ROOT = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/TYMC';

async function getTdxToken(env) {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) throw new Error('TDX credentials are not configured');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.TDX_CLIENT_ID,
    client_secret: env.TDX_CLIENT_SECRET
  });
  const response = await fetch(TDX_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw new Error(`TDX token HTTP ${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw new Error('TDX token missing');
  return data.access_token;
}

function textValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.Zh_tw || value.En || value.zh_tw || value.en || '';
}

function serviceType(row) {
  const raw = String(row.TrainType || row.ServiceType || row.TrainTypeCode || row.TrainTypeID || '').toLowerCase();
  const name = `${textValue(row.TrainTypeName)} ${textValue(row.ServiceTypeName)}`.toLowerCase();
  return /express|直達|purple|2/.test(`${raw} ${name}`) ? 'express' : 'commuter';
}

function directionType(row) {
  const destination = `${row.DestinationStationID || ''} ${textValue(row.DestinationStationName)} ${textValue(row.TripHeadSign)}`.toLowerCase();
  if (/a1\b|taipei|台北/.test(destination)) return 'taipei';
  if (/a21\b|a22\b|zhongli|laojie|中壢|老街溪/.test(destination)) return 'zhongli';
  const direction = Number(row.Direction);
  if (direction === 1) return 'taipei';
  if (direction === 0) return 'zhongli';
  return null;
}

function liveTime(row) {
  const direct = row.EstimateTime ?? row.EstimateTimeSec ?? row.CountDown ?? row.Countdown;
  if (Number.isFinite(Number(direct))) {
    const seconds = Number(direct);
    if (seconds <= 45) return 'Arriving';
    const target = new Date(Date.now() + seconds * 1000);
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(target);
  }
  const value = row.EstimatedArrivalTime || row.NextTrainTime || row.ArrivalTime || row.ScheduleArrivalTime;
  if (!value) return null;
  const match = String(value).match(/(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function normalizeLiveBoard(payload, station) {
  const rows = Array.isArray(payload) ? payload : (payload.LiveBoards || payload.value || payload.data || []);
  const result = {
    taipei: { commuter: null, express: null },
    zhongli: { commuter: null, express: null }
  };
  let updateTime = null;
  for (const row of rows) {
    const direction = directionType(row);
    const type = serviceType(row);
    const time = liveTime(row);
    if (!direction || !time) continue;
    if (!result[direction][type]) result[direction][type] = { time };
    updateTime = updateTime || row.UpdateTime || row.SrcUpdateTime || row.DataCollectTime || null;
  }
  const count = Object.values(result).flatMap(x => Object.values(x)).filter(Boolean).length;
  if (!count) throw new Error(`No usable LiveBoard rows for ${station}`);
  return { trains: result, updateTime };
}

async function fetchTdxLiveBoard(station, token) {
  const encoded = encodeURIComponent(station);
  const candidates = [
    `${TDX_API_ROOT}/Station/${encoded}?$format=JSON`,
    `${TDX_API_ROOT}?$filter=StationID%20eq%20'${encoded}'&$format=JSON`
  ];
  let lastError;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      if (!response.ok) throw new Error(`TDX LiveBoard HTTP ${response.status}`);
      return normalizeLiveBoard(await response.json(), station);
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('TDX LiveBoard request failed');
}

async function getMrt(request, env, ctx) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || 'A13').toUpperCase();
  if (!/^A(?:[1-9]|1\d|2[0-2]|14A)$/.test(station)) return Response.json({ error: 'Invalid station' }, { status: 400 });

  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = '/api/mrt-cache';
  cacheUrl.search = `station=${station}&slot=${Math.floor(Date.now() / 30000)}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const token = await getTdxToken(env);
    const live = await fetchTdxLiveBoard(station, token);
    const response = Response.json({
      mode: 'live',
      station,
      source: 'TDX / Taoyuan Metro',
      fetchedAt: new Date().toISOString(),
      ...live
    }, { headers: { 'cache-control': 'public, max-age=15, s-maxage=30' } });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return Response.json({
      mode: 'fallback',
      station,
      error: String(error?.message || error),
      fetchedAt: new Date().toISOString()
    }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/arinc') return getArinc(request, env, ctx);
    if (url.pathname === '/api/mrt') return getMrt(request, env, ctx);
    return env.ASSETS.fetch(request);
  }
};
