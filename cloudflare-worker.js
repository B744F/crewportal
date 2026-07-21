/**
 * Crew Portal API — Cloudflare Worker
 * Version 1.0.0
 *
 * Required secrets:
 *   TDX_CLIENT_ID
 *   TDX_CLIENT_SECRET
 */

const PARKING_API = 'http://1.34.202.50:9130/parking_place/huahang';
const TDX_TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_LIVEBOARD_ROOT = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/TYMC';
const ALLOWED_ORIGINS = new Set([
  'https://b744f.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
]);

let tokenCache = { token: '', expiresAt: 0 };

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://b744f.github.io';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(request, body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function stationIsValid(station) {
  return /^A(?:[1-9]|1[0-3]|1[5-9]|2[0-2]|14A)$/.test(station);
}

function multilingualText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.Zh_tw || value.Zh_TW || value.En || value.zh_tw || value.en || '';
}

function trainType(row) {
  const source = [
    row.TrainType,
    row.ServiceType,
    row.TrainTypeCode,
    row.TrainTypeID,
    multilingualText(row.TrainTypeName),
    multilingualText(row.ServiceTypeName)
  ].filter(Boolean).join(' ').toLowerCase();

  return /express|直達/.test(source) ? 'express' : 'commuter';
}

function trainDirection(row) {
  const destination = [
    row.DestinationStationID,
    multilingualText(row.DestinationStationName),
    multilingualText(row.TripHeadSign)
  ].filter(Boolean).join(' ').toLowerCase();

  if (/\ba1\b|taipei|台北/.test(destination)) return 'taipei';
  if (/\ba21\b|\ba22\b|zhongli|laojie|中壢|老街溪/.test(destination)) return 'zhongli';

  // TDX metro convention: 0 = outbound/southbound, 1 = inbound/northbound.
  if (Number(row.Direction) === 1) return 'taipei';
  if (Number(row.Direction) === 0) return 'zhongli';
  return null;
}

function formatTaipeiTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function arrivalValue(row) {
  const secondsValue = row.EstimateTime ?? row.EstimateTimeSec ?? row.CountDown ?? row.Countdown;
  const seconds = Number(secondsValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    if (seconds <= 45) return { time: 'Arriving', seconds };
    return { time: formatTaipeiTime(new Date(Date.now() + seconds * 1000)), seconds };
  }

  const clock = row.EstimatedArrivalTime || row.NextTrainTime || row.ArrivalTime || row.ScheduleArrivalTime;
  const match = String(clock || '').match(/(?:T|\s)?(\d{2}:\d{2})(?::\d{2})?/);
  return match ? { time: match[1], seconds: null } : null;
}

function normalizeLiveBoard(payload, station) {
  const rows = Array.isArray(payload)
    ? payload
    : payload.LiveBoards || payload.value || payload.data || [];

  const trains = {
    taipei: { commuter: null, express: null },
    zhongli: { commuter: null, express: null }
  };

  let updateTime = null;
  for (const row of rows) {
    const rowStation = String(row.StationID || row.StationUID || '').toUpperCase();
    if (rowStation && !rowStation.endsWith(station)) continue;

    const direction = trainDirection(row);
    const type = trainType(row);
    const arrival = arrivalValue(row);
    if (!direction || !arrival) continue;

    const current = trains[direction][type];
    if (!current || (arrival.seconds !== null && (current.seconds === null || arrival.seconds < current.seconds))) {
      trains[direction][type] = {
        time: arrival.time,
        seconds: arrival.seconds,
        destination: multilingualText(row.DestinationStationName) || multilingualText(row.TripHeadSign) || null
      };
    }

    updateTime = updateTime || row.UpdateTime || row.SrcUpdateTime || row.DataCollectTime || null;
  }

  const usable = Object.values(trains).flatMap(direction => Object.values(direction)).filter(Boolean);
  if (!usable.length) throw new Error(`No usable LiveBoard data for ${station}`);
  return { trains, updateTime };
}

async function getTdxToken(env) {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) {
    throw new Error('TDX credentials are not configured');
  }

  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;

  const response = await fetch(TDX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.TDX_CLIENT_ID,
      client_secret: env.TDX_CLIENT_SECRET
    })
  });

  if (!response.ok) throw new Error(`TDX token request failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error('TDX token response did not contain access_token');

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in) || 900) * 1000
  };
  return tokenCache.token;
}

async function requestLiveBoard(station, token) {
  const filter = encodeURIComponent(`StationID eq '${station}'`);
  const urls = [
    `${TDX_LIVEBOARD_ROOT}/Station/${encodeURIComponent(station)}?$format=JSON`,
    `${TDX_LIVEBOARD_ROOT}?$filter=${filter}&$format=JSON`
  ];

  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        cf: { cacheTtl: 20, cacheEverything: true }
      });
      if (!response.ok) throw new Error(`TDX LiveBoard request failed (${response.status})`);
      return normalizeLiveBoard(await response.json(), station);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('TDX LiveBoard request failed');
}

async function handleMrt(request, env, ctx) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || 'A13').toUpperCase();
  if (!stationIsValid(station)) return json(request, { ok: false, error: 'Invalid station' }, { status: 400 });

  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.search = `station=${station}&slot=${Math.floor(Date.now() / 30_000)}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const token = await getTdxToken(env);
    const live = await requestLiveBoard(station, token);
    const response = json(request, {
      ok: true,
      mode: 'live',
      station,
      source: 'TDX / Taoyuan Metro',
      fetchedAt: new Date().toISOString(),
      ...live
    }, {
      headers: { 'Cache-Control': 'public, max-age=15, s-maxage=30' }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return json(request, {
      ok: false,
      mode: 'fallback',
      station,
      fetchedAt: new Date().toISOString(),
      error: String(error?.message || error)
    }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

async function handleParking(request) {
  try {
    const response = await fetch(PARKING_API, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cf: { cacheTtl: 30, cacheEverything: true }
    });
    const text = await response.text();
    return json(request, {
      online: response.ok,
      status: response.status,
      statusText: response.statusText,
      preview: text.slice(0, 500)
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return json(request, { online: false, error: String(error?.message || error) }, { status: 502 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== 'GET') {
      return json(request, { ok: false, error: 'Method not allowed' }, { status: 405 });
    }

    if (url.pathname === '/api/mrt') return handleMrt(request, env, ctx);
    if (url.pathname === '/api/parking' || url.pathname === '/') return handleParking(request);
    if (url.pathname === '/api/health') {
      return json(request, {
        ok: true,
        service: 'Crew Portal API',
        version: '1.0.0',
        tdxConfigured: Boolean(env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET),
        timestamp: new Date().toISOString()
      });
    }

    return json(request, { ok: false, error: 'Not found' }, { status: 404 });
  }
};
