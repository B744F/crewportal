/**
 * Crew Portal API — Cloudflare Worker
 * Version 2.3.0 (Crew Portal v8.0.0)
 *
 * Primary MRT source: Taoyuan City Government Open Data XML
 * Dataset: 桃園捷運站別時刻表資料
 * Secondary source: TDX TYMC LiveBoard (optional live status)
 *
 * Required secrets for live status:
 *   TDX_CLIENT_ID
 *   TDX_CLIENT_SECRET
 */

const PORTAL_VERSION = 'v8.0.0';
const WORKER_VERSION = '2.3.0';
const PARKING_API = 'http://1.34.202.50:9130/parking_place/huahang';
const TYM_OPEN_DATA_XML = 'https://opendata.tycg.gov.tw/api/dataset/8e6201c2-1968-4920-aba3-1a68093dab53/resource/83358afd-010a-4989-b63a-bbf20692e408/download';
const TYM_OFFICIAL_TIMETABLE = 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-';
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

function officialStationCode(station) {
  return station === 'A14A' ? 'A14a' : station;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .trim();
}

function tagValue(xml, names) {
  for (const name of names) {
    const match = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decodeXml(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }
  return '';
}

function tagBlocks(xml, names) {
  const blocks = [];
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi');
    let match;
    while ((match = re.exec(String(xml || '')))) blocks.push(match[1]);
    if (blocks.length) break;
  }
  return blocks;
}

function normalizeStationId(value) {
  return String(value || '').trim().toUpperCase();
}

function stationNumber(value) {
  const match = normalizeStationId(value).match(/^A(\d+)(?:A)?$/);
  return match ? Number(match[1]) : null;
}

function taipeiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    minutes: Number(value.hour) * 60 + Number(value.minute) + Number(value.second) / 60,
    date: `${value.year}-${value.month}-${value.day}`,
    weekday: value.weekday
  };
}

function serviceRunsToday(xml, weekday) {
  const service = tagBlocks(xml, ['ServiceDays', 'ServiceDay'])[0] || xml;
  const names = {
    Sun: ['Sunday', 'Sun'], Mon: ['Monday', 'Mon'], Tue: ['Tuesday', 'Tue'],
    Wed: ['Wednesday', 'Wed'], Thu: ['Thursday', 'Thu'], Fri: ['Friday', 'Fri'], Sat: ['Saturday', 'Sat']
  }[weekday] || [];
  let found = false;
  for (const name of names) {
    const raw = tagValue(service, [name]);
    if (!raw) continue;
    found = true;
    return /^(1|true|yes|y)$/i.test(raw);
  }
  return !found;
}

function parseClock(value) {
  const match = String(value || '').match(/(?:^|\s)([0-2]?\d):([0-5]\d)(?::[0-5]\d)?(?:\s|$)/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23) return null;
  return { hour, minute, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

function classifyDirection(record, station) {
  const directionCode = tagValue(record, ['Direction']);
  const destinationStationId = normalizeStationId(
    tagValue(record, ['DestinationStationID', 'DestinationStaionID'])
  );
  const stationIndex = stationNumber(station);
  const destinationIndex = stationNumber(destinationStationId);
  if (!['0', '1'].includes(directionCode) || stationIndex === null || destinationIndex === null) return null;

  // Official TYMC convention: 0 = southbound, 1 = northbound.
  // DestinationStationID validates the direction without reading display text.
  if (directionCode === '0' && destinationIndex > stationIndex) return 'zhongli';
  if (directionCode === '1' && destinationIndex < stationIndex) return 'taipei';
  return null;
}

function classifyTrainType(entry, record) {
  const raw = tagValue(entry, ['TrainType']) || tagValue(record, ['TrainType']);
  const code = String(raw).trim().toLowerCase();
  // Official TYMC timetable values: 0 = commuter, 2 = express.
  if (code === '0' || code === 'commuter') return 'commuter';
  if (code === '2' || code === 'express') return 'express';
  return null;
}

function parseOpenDataRows(xml, station) {
  const now = taipeiNow();
  let records = tagBlocks(xml, ['StationTimeTable', 'StationTimetable', 'StationTimetables']);
  if (!records.length) records = tagBlocks(xml, ['Data', 'Record']);
  const rows = [];
  const seen = new Set();

  for (const record of records) {
    const stationId = normalizeStationId(tagValue(record, ['StationID', 'StationId']));
    if (stationId !== station) continue;
    if (!serviceRunsToday(record, now.weekday)) continue;
    const direction = classifyDirection(record, station);
    if (!direction) continue;

    let entries = tagBlocks(record, ['Timetable', 'Timetables']);
    // When <Timetables> is only a container, extract its child timetable rows.
    if (entries.length === 1 && /<(?:Timetable|StopTime|TrainTime)\b/i.test(entries[0])) {
      entries = tagBlocks(entries[0], ['Timetable', 'StopTime', 'TrainTime']);
    }
    if (!entries.length) entries = [record];

    for (const entry of entries) {
      const clock = parseClock(tagValue(entry, ['DepartureTime', 'ArrivalTime', 'Time', 'TrainTime']));
      if (!clock) continue;
      const type = classifyTrainType(entry, record);
      if (!type) continue;
      const key = `${direction}:${type}:${clock.time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ direction, type, ...clock });
    }
  }
  return { rows, serviceDate: now.date, recordCount: records.length };
}

function selectNext(rows, nowMinutes) {
  let best = null;
  for (const row of rows) {
    let serviceMinutes = row.hour * 60 + row.minute;
    if (nowMinutes >= 18 * 60 && row.hour < 3) serviceMinutes += 1440;
    if (serviceMinutes + 0.01 < nowMinutes) continue;
    if (!best || serviceMinutes < best.serviceMinutes) best = { ...row, serviceMinutes };
  }
  if (!best) return null;
  const { serviceMinutes, ...train } = best;
  return train;
}

function buildNextTrains(rows) {
  const now = taipeiNow();
  const by = (direction, type) => selectNext(rows.filter(r => r.direction === direction && r.type === type), now.minutes);
  const trains = {
    taipei: { commuter: by('taipei', 'commuter'), express: by('taipei', 'express') },
    zhongli: { commuter: by('zhongli', 'commuter'), express: by('zhongli', 'express') }
  };
  if (!Object.values(trains).flatMap(group => Object.values(group)).some(Boolean)) {
    throw new Error('No upcoming trains in official open data');
  }
  return trains;
}

async function requestOpenDataTimetable(station) {
  const response = await fetch(TYM_OPEN_DATA_XML, {
    headers: { 'Accept': 'application/xml,text/xml,*/*', 'User-Agent': 'CrewPortal/8.0' },
    cf: { cacheTtl: 1800, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Taoyuan Open Data request failed (${response.status})`);
  const xml = await response.text();
  if (!xml || !/<[^>]+>/.test(xml)) throw new Error('Taoyuan Open Data returned invalid XML');
  const parsed = parseOpenDataRows(xml, station);
  if (!parsed.rows.length) throw new Error(`No official open-data rows found for ${station}`);
  return {
    trains: buildNextTrains(parsed.rows),
    serviceDate: parsed.serviceDate,
    sourceRows: parsed.rows.length,
    sourceRecords: parsed.recordCount,
    officialUrl: `${TYM_OFFICIAL_TIMETABLE}${officialStationCode(station)}`,
    timetableParser: 'structured-official'
  };
}

function trainType(row) {
  const code = String(row.TrainType ?? '').trim().toLowerCase();
  if (code === '2' || code === 'express') return 'express';
  if (code === '0' || code === 'commuter') return 'commuter';
  return null;
}
function trainDirection(row) {
  const directionCode = String(row.Direction ?? '').trim();
  const destinationStationId = normalizeStationId(row.DestinationStationID ?? row.DestinationStaionID);
  if (!['0', '1'].includes(directionCode)) return null;
  if (!stationNumber(row.StationID) || !stationNumber(destinationStationId)) return null;
  if (directionCode === '0' && stationNumber(destinationStationId) > stationNumber(row.StationID)) return 'zhongli';
  if (directionCode === '1' && stationNumber(destinationStationId) < stationNumber(row.StationID)) return 'taipei';
  return null;
}

async function getTdxToken(env) {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) return null;
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const response = await fetch(TDX_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET })
  });
  if (!response.ok) throw new Error(`TDX token request failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error('TDX token response missing access_token');
  tokenCache = { token: data.access_token, expiresAt: Date.now() + Math.max(300, Number(data.expires_in) || 900) * 1000 };
  return tokenCache.token;
}

async function requestLiveStatus(station, env) {
  try {
    const token = await getTdxToken(env);
    if (!token) return null;
    const filter = encodeURIComponent(`StationID eq '${station}'`);
    const urls = [
      `${TDX_LIVEBOARD_ROOT}/Station/${encodeURIComponent(station)}?$format=JSON`,
      `${TDX_LIVEBOARD_ROOT}?$filter=${filter}&$format=JSON`
    ];
    for (const url of urls) {
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }, cf: { cacheTtl: 20, cacheEverything: true } });
      if (!response.ok) continue;
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.LiveBoards || payload.value || payload.data || [];
      const live = [];
      for (const row of rows) {
        const direction = trainDirection(row);
        if (!direction) continue;
        const type = trainType(row);
        if (!type) continue;
        const seconds = Number(row.EstimateTime ?? row.EstimateTimeSec ?? row.CountDown ?? row.Countdown);
        if (!Number.isFinite(seconds) || seconds < 0) continue;
        live.push({ direction, type, seconds });
      }
      if (live.length) return live;
    }
  } catch (_) {}
  return null;
}

async function handleMrt(request, env, ctx) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || 'A13').toUpperCase();
  const debug = url.searchParams.get('debug') === '1';
  if (!stationIsValid(station)) return json(request, { ok: false, error: 'Invalid station' }, { status: 400 });

  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.search = `station=${station}&slot=${Math.floor(Date.now() / 60_000)}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  if (!debug) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  try {
    const [timetable, live] = await Promise.all([requestOpenDataTimetable(station), requestLiveStatus(station, env)]);
    const payload = {
      ok: true,
      mode: 'timetable',
      station,
      source: 'Taoyuan City Government Open Data',
      sourceType: 'structured-official',
      timetableParser: 'structured-official',
      liveSource: live ? 'TDX LiveBoard' : null,
      fetchedAt: new Date().toISOString(),
      live,
      ...timetable
    };
    if (!debug) { delete payload.sourceRows; delete payload.sourceRecords; }
    const response = json(request, payload, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
    if (!debug) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return json(request, {
      ok: false, mode: 'unavailable', station, source: 'Taoyuan City Government Open Data',
      fetchedAt: new Date().toISOString(), error: String(error?.message || error)
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function handleParking(request) {
  try {
    const response = await fetch(PARKING_API, { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheTtl: 30, cacheEverything: true } });
    const text = await response.text();
    return json(request, { online: response.ok, status: response.status, statusText: response.statusText, preview: text.slice(0, 500) }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return json(request, { online: false, error: String(error?.message || error) }, { status: 502 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== 'GET') return json(request, { ok: false, error: 'Method not allowed' }, { status: 405 });
    if (url.pathname === '/api/mrt') return handleMrt(request, env, ctx);
    if (url.pathname === '/api/parking' || url.pathname === '/') return handleParking(request);
    if (url.pathname === '/api/health') return json(request, {
      ok: true, service: 'Crew Portal API', version: WORKER_VERSION,
      workerVersion: WORKER_VERSION,
      portalVersion: PORTAL_VERSION,
      timetableSource: 'Taoyuan City Government Open Data XML',
      timetableParser: 'structured-official',
      tdxLiveConfigured: Boolean(env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET),
      timestamp: new Date().toISOString()
    });
    return json(request, { ok: false, error: 'Not found' }, { status: 404 });
  }
};
