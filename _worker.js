/**
 * Crew Portal API — Cloudflare Worker
 * Version 2.1.0 (Crew Portal v7.1.0)
 *
 * Primary MRT source: Taoyuan Metro official station timetable pages.
 * Secondary source: TDX TYMC LiveBoard (optional live status).
 *
 * Required secrets for live status:
 *   TDX_CLIENT_ID
 *   TDX_CLIENT_SECRET
 */

const PARKING_API = 'http://1.34.202.50:9130/parking_place/huahang';
const TYM_TIMETABLE_ROOT = 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-';
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
  if (Number(row.Direction) === 1) return 'taipei';
  if (Number(row.Direction) === 0) return 'zhongli';
  return null;
}

function taipeiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    minutes: Number(value.hour) * 60 + Number(value.minute) + Number(value.second) / 60,
    date: `${value.year}-${value.month}-${value.day}`
  };
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

function htmlToText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return '';
  const from = start + startMarker.length;
  const end = text.indexOf(endMarker, from);
  return text.slice(from, end > from ? end : text.length);
}

function parseDirectionSection(section, direction) {
  const results = [];
  const seen = new Set();
  const pattern = /(\d{2})點\s*(\d{2})\s*([\s\S]*?)(?=\d{2}點\s*\d{2}|目前無班次|$)/g;
  let match;
  while ((match = pattern.exec(section))) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    const description = match[3].slice(0, 180);
    const type = /直達車/.test(description) ? 'express' : 'commuter';
    const key = `${hour}:${minute}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      direction,
      type,
      hour,
      minute,
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      note: /尖峰/.test(description) ? 'peak' : null
    });
  }
  return results;
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

function normalizeOfficialTimetable(html, station) {
  const text = htmlToText(html);
  const taipeiMarker = '時間 往台北車站';
  const zhongliMarker = '時間 往中壢';
  const firstTaipei = text.indexOf(taipeiMarker);
  const firstZhongli = text.indexOf(zhongliMarker);
  if (firstTaipei < 0 && firstZhongli < 0) throw new Error('Official timetable format not recognized');

  let taipeiSection = '';
  let zhongliSection = '';
  if (firstTaipei >= 0 && firstZhongli >= 0) {
    taipeiSection = sectionBetween(text, taipeiMarker, zhongliMarker);
    zhongliSection = sectionBetween(text, zhongliMarker, taipeiMarker);
  } else if (firstTaipei >= 0) {
    taipeiSection = text.slice(firstTaipei + taipeiMarker.length);
  } else {
    zhongliSection = text.slice(firstZhongli + zhongliMarker.length);
  }

  // Each official page includes desktop/mobile duplicates. Parsing and de-duplication
  // deliberately handles both without relying on unstable CSS class names.
  const rows = [
    ...parseDirectionSection(taipeiSection, 'taipei'),
    ...parseDirectionSection(zhongliSection, 'zhongli')
  ];
  if (!rows.length) throw new Error(`No timetable rows found for ${station}`);

  const now = taipeiNow();
  const by = (direction, type) => selectNext(rows.filter(r => r.direction === direction && r.type === type), now.minutes);
  const trains = {
    taipei: { commuter: by('taipei', 'commuter'), express: by('taipei', 'express') },
    zhongli: { commuter: by('zhongli', 'commuter'), express: by('zhongli', 'express') }
  };
  const usable = Object.values(trains).flatMap(group => Object.values(group)).filter(Boolean);
  if (!usable.length) throw new Error(`No upcoming official timetable trains for ${station}`);
  return { trains, serviceDate: now.date };
}

async function requestOfficialTimetable(station) {
  const url = `${TYM_TIMETABLE_ROOT}${officialStationCode(station)}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; CrewPortal/7.1; +https://b744f.github.io)'
    },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Taoyuan Metro timetable request failed (${response.status})`);
  const html = await response.text();
  return { ...normalizeOfficialTimetable(html, station), officialUrl: url };
}

async function getTdxToken(env) {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) return null;
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
  if (!data.access_token) throw new Error('TDX token response missing access_token');
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in) || 900) * 1000
  };
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
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        cf: { cacheTtl: 20, cacheEverything: true }
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.LiveBoards || payload.value || payload.data || [];
      const live = [];
      for (const row of rows) {
        const direction = trainDirection(row);
        if (!direction) continue;
        const seconds = Number(row.EstimateTime ?? row.EstimateTimeSec ?? row.CountDown ?? row.Countdown);
        if (!Number.isFinite(seconds) || seconds < 0) continue;
        live.push({ direction, type: trainType(row), seconds });
      }
      if (live.length) return live;
    }
  } catch (_) {
    // Timetable remains available even when TDX live status is unavailable.
  }
  return null;
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
    const [timetable, live] = await Promise.all([
      requestOfficialTimetable(station),
      requestLiveStatus(station, env)
    ]);
    const response = json(request, {
      ok: true,
      mode: 'timetable',
      station,
      source: 'Taoyuan Metro Official Timetable',
      liveSource: live ? 'TDX LiveBoard' : null,
      fetchedAt: new Date().toISOString(),
      live,
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
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== 'GET') return json(request, { ok: false, error: 'Method not allowed' }, { status: 405 });
    if (url.pathname === '/api/mrt') return handleMrt(request, env, ctx);
    if (url.pathname === '/api/parking' || url.pathname === '/') return handleParking(request);
    if (url.pathname === '/api/health') {
      return json(request, {
        ok: true,
        service: 'Crew Portal API',
        version: '2.1.0',
        timetableSource: 'Taoyuan Metro Official Timetable',
        tdxLiveConfigured: Boolean(env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET),
        timestamp: new Date().toISOString()
      });
    }
    return json(request, { ok: false, error: 'Not found' }, { status: 404 });
  }
};
