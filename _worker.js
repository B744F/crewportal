/**
 * Crew Portal API — Cloudflare Worker
 * Version 2.0.0
 *
 * Required secrets:
 *   TDX_CLIENT_ID
 *   TDX_CLIENT_SECRET
 */

const PARKING_API = 'http://1.34.202.50:9130/parking_place/huahang';
const TDX_TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_LIVEBOARD_ROOT = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/TYMC';
const TDX_TIMETABLE_ROOT = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/DailyTimetable/Station/TYMC';
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

function estimatedClockTime(seconds) {
  // Round upward to the next displayed minute so a train arriving in a few
  // seconds is shown as the useful departure clock time, not “Arriving”.
  const estimated = Date.now() + Math.max(0, seconds) * 1000;
  return formatTaipeiTime(new Date(Math.ceil(estimated / 60_000) * 60_000));
}

function arrivalValue(row) {
  const secondsValue = row.EstimateTime ?? row.EstimateTimeSec ?? row.CountDown ?? row.Countdown;
  const seconds = Number(secondsValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return { time: estimatedClockTime(seconds), seconds };
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


function taipeiNowMinutes() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    minutes: Number(value.hour) * 60 + Number(value.minute) + Number(value.second) / 60,
    weekday: value.weekday,
    date: `${value.year}-${value.month}-${value.day}`
  };
}

function clockMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clockText(value) {
  const minutes = clockMinutes(value);
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function timetableRows(payload) {
  const roots = Array.isArray(payload) ? payload : payload?.value || payload?.data || payload?.StationTimetables || [payload];
  const rows = [];
  for (const root of roots || []) {
    const list = root?.Timetables || root?.StationTimetables || root?.DailyTimetables || root?.StopTimes || [];
    if (Array.isArray(list) && list.length) {
      for (const item of list) rows.push({ ...root, ...item });
    } else if (root && (root.DepartureTime || root.ArrivalTime || root.Time)) {
      rows.push(root);
    }
  }
  return rows;
}

function normalizeTimetable(payload, station) {
  const now = taipeiNowMinutes();
  const trains = {
    taipei: { commuter: null, express: null },
    zhongli: { commuter: null, express: null }
  };

  for (const row of timetableRows(payload)) {
    const rowStation = String(row.StationID || row.StationUID || row.StopID || '').toUpperCase();
    if (rowStation && !rowStation.endsWith(station)) continue;

    const rawTime = row.DepartureTime || row.ArrivalTime || row.Time || row.ScheduleDepartureTime || row.ScheduleArrivalTime;
    const minutes = clockMinutes(rawTime);
    if (minutes === null || minutes + 0.01 < now.minutes) continue;

    const direction = trainDirection(row);
    if (!direction) continue;
    const type = trainType(row);
    const current = trains[direction][type];
    if (!current || minutes < current.minutes) {
      trains[direction][type] = {
        time: clockText(rawTime),
        minutes,
        destination: multilingualText(row.DestinationStationName) || multilingualText(row.TripHeadSign) || null,
        trainNo: row.TrainNo || row.TrainID || null
      };
    }
  }

  for (const direction of Object.values(trains)) {
    for (const type of Object.keys(direction)) {
      if (direction[type]) delete direction[type].minutes;
    }
  }

  const usable = Object.values(trains).flatMap(direction => Object.values(direction)).filter(Boolean);
  if (!usable.length) throw new Error(`No upcoming timetable data for ${station}`);
  return { trains, serviceDate: now.date, updateTime: new Date().toISOString() };
}

async function requestDailyTimetable(station, token) {
  const filter = encodeURIComponent(`StationID eq '${station}'`);
  const urls = [
    `${TDX_TIMETABLE_ROOT}/${encodeURIComponent(station)}?$format=JSON`,
    `${TDX_TIMETABLE_ROOT}?$filter=${filter}&$format=JSON`
  ];

  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        cf: { cacheTtl: 300, cacheEverything: true }
      });
      if (!response.ok) throw new Error(`TDX timetable request failed (${response.status})`);
      return normalizeTimetable(await response.json(), station);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('TDX timetable request failed');
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
  cacheUrl.search = `station=${station}&slot=${Math.floor(Date.now() / 60_000)}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const token = await getTdxToken(env);
    const timetable = await requestDailyTimetable(station, token);
    const response = json(request, {
      ok: true,
      mode: 'timetable',
      station,
      source: 'TDX / Taoyuan Metro',
      fetchedAt: new Date().toISOString(),
      ...timetable
    }, {
      headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' }
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
        version: '2.0.0',
        tdxConfigured: Boolean(env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET),
        timestamp: new Date().toISOString()
      });
    }

    return json(request, { ok: false, error: 'Not found' }, { status: 404 });
  }
};
