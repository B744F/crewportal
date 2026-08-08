/**
 * Crew Portal API — Cloudflare Worker
 * Version 2.8.72 (Crew Portal v8.2.72)
 *
 * Primary MRT source: TDX TYMC StationTimeTable
 * Fallback MRT source: Taoyuan City Government Open Data XML
 * TDX LiveBoard is intentionally disabled because the timetable is the
 * official data rendered by the portal and LiveBoard caused avoidable quota use.
 *
 * Required secrets for TDX timetable and Airport FIDS fallback:
 *   TDX_CLIENT_ID
 *   TDX_CLIENT_SECRET
 */

const PORTAL_VERSION = 'v8.2.72';
const WORKER_VERSION = '2.8.72';
const DEFAULT_FLIGHT_AIRLINE = 'CI';
const FLIGHT_UPSTREAM_TIMEOUT_MS = 7_000;
const LIVE_FLIGHT_REFRESH_AGE_SECONDS = 10 * 60;
const TDX_FIDS_CACHE_BUCKET_SECONDS = 5 * 60;
const PARKING_API = 'http://1.34.202.50:9130/parking_place/huahang';
const TPE_FLIGHT_SOURCE = 'https://raw.githubusercontent.com/B744F/crewportal/main/data/flight-gates.json';
const TPE_OFFICIAL_FLIGHT_SOURCE = 'https://odp.taoyuan-airport.com/dataset/2025102001?format=csv';
const TPE_OFFICIAL_FLIGHT_IPS = ['60.251.215.156', '60.251.184.156'];
const TPE_GOSS_CARGO_SOURCE = 'https://www.tpegoss.com/api/db/gates/schedule';
const RCTP_CARGO_STAND_MIN = 501;
const RCTP_CARGO_STAND_MAX = 525;
const TYM_OPEN_DATA_XML = 'https://opendata.tycg.gov.tw/api/dataset/8e6201c2-1968-4920-aba3-1a68093dab53/resource/83358afd-010a-4989-b63a-bbf20692e408/download';
const TYM_OFFICIAL_TIMETABLE = 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-';
const TDX_TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_TIMETABLE_ROOT = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/StationTimeTable/TYMC';
const TDX_AIRPORT_FIDS_ROOT = 'https://tdx.transportdata.tw/api/basic/v2/Air/FIDS/Airport';
const GATE_AIRPORTS = {
  RCTP: { icao: 'RCTP', iata: 'TPE', name: '桃園國際機場' },
  RCSS: { icao: 'RCSS', iata: 'TSA', name: '臺北松山機場' },
  RCMQ: { icao: 'RCMQ', iata: 'RMQ', name: '臺中國際機場' },
  RCKH: { icao: 'RCKH', iata: 'KHH', name: '高雄國際機場' }
};
const REGIONAL_GATE_SOURCES = {
  RCSS: [
    { direction: 'D', url: 'https://www.tsa.gov.tw/api/publicDataArea/GetFormaterData?id=42879f51-f47f-4d26-8b2b-5535c652cbde' },
    { direction: 'A', url: 'https://www.tsa.gov.tw/api/publicDataArea/GetFormaterData?id=7dc1379a-9485-4491-866d-fc4f9590ffcf' },
    { direction: 'D', url: 'https://www.tsa.gov.tw/api/publicDataArea/GetFormaterData?id=c0f7d5b4-ba73-46d2-8485-6595c64c4e17' },
    { direction: 'A', url: 'https://www.tsa.gov.tw/api/publicDataArea/GetFormaterData?id=3057d52f-7a71-49e1-a0d4-87ffa3449a6a' }
  ],
  RCMQ: [
    { direction: 'D', url: 'https://www.tca.gov.tw/?act=fids&code=airflytab&Flyline=1&FlyIO=1' },
    { direction: 'A', url: 'https://www.tca.gov.tw/?act=fids&code=airflytab&Flyline=1&FlyIO=2' },
    { direction: 'D', url: 'https://www.tca.gov.tw/?act=fids&code=airflytab&Flyline=2&FlyIO=1' },
    { direction: 'A', url: 'https://www.tca.gov.tw/?act=fids&code=airflytab&Flyline=2&FlyIO=2' }
  ],
  RCKH: [
    { direction: 'D', url: 'https://www.kia.gov.tw/Announce/NewsArea/InstantSchedule_INTDEP.json' },
    { direction: 'D', url: 'https://www.kia.gov.tw/Announce/NewsArea/InstantSchedule_DOMDEP.json' },
    { direction: 'A', url: 'https://www.kia.gov.tw/Announce/NewsArea/InstantSchedule_INTARR.json' },
    { direction: 'A', url: 'https://www.kia.gov.tw/Announce/NewsArea/InstantSchedule_DOMARR.json' }
  ]
};
const ALLOWED_ORIGINS = new Set([
  'https://b744f.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
]);

let tokenCache = { token: '', expiresAt: 0 };
const tdxTimetableCache = new Map();
let airportFlightCache = { version: '', loadedAt: 0, fetchedAt: 0, source: '', continuityRows: 0, rows: null };
let airportFlightRefreshPromise = null;
let tdxAirportFidsCache = { loadedAt: 0, rows: null };
const regionalAirportFlightCache = new Map();
const regionalTdxAirportCache = new Map();
const TDX_EDGE_CACHE_ORIGIN = 'https://flightdeck-tdx-cache.invalid';
function tdxAirportFidsCacheKey(bucketOffset = 0) {
  const bucket = Math.floor(Date.now() / (TDX_FIDS_CACHE_BUCKET_SECONDS * 1000)) + bucketOffset;
  return new Request(`${TDX_EDGE_CACHE_ORIGIN}/airport-fids/TPE/${bucket}`, { method: 'GET' });
}

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

async function fetchUpstream(resource, init = {}, timeoutMs = FLIGHT_UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('upstream timeout'), timeoutMs);
  try {
    return await fetch(resource, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFlightQuery(value) {
  const compact = String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
  const numericOnly = compact.match(/^(\d{1,4}[A-Z]?)$/);
  const match = numericOnly || compact.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/) || compact.match(/^([A-Z]{3})(\d{1,4}[A-Z]?)$/);
  if (!match) return null;
  const airline = numericOnly ? DEFAULT_FLIGHT_AIRLINE : match[2] ? match[1] : DEFAULT_FLIGHT_AIRLINE;
  const rawNumber = match[2] || match[1];
  const suffix = /[A-Z]$/.test(rawNumber) ? rawNumber.slice(-1) : '';
  const digits = rawNumber.slice(0, rawNumber.length - suffix.length).replace(/^0+(?=\d)/, '');
  return { airline, number: `${digits}${suffix}` };
}

function normalizeGateAirport(value) {
  const airport = String(value || 'RCTP').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(GATE_AIRPORTS, airport) ? airport : null;
}

function regionalPayloadRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

function regionalDate(value, today) {
  const text = String(value || '').trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const monthDay = text.match(/^(\d{2})(\d{2})$/);
  if (monthDay) return `${today.slice(0, 4)}-${monthDay[1]}-${monthDay[2]}`;
  return text.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] || '';
}

function regionalTime(value) {
  const text = String(value || '').trim();
  const colon = text.match(/^(\d{1,2}):(\d{2})/);
  if (colon) return `${colon[1].padStart(2, '0')}:${colon[2]}`;
  const compact = text.match(/^(\d{2})(\d{2})$/);
  return compact ? `${compact[1]}:${compact[2]}` : '';
}

function regionalFlightIdentity(rawAirline, rawNumber) {
  const airline = String(rawAirline || '').trim().toUpperCase();
  const flightNumber = String(rawNumber || '').trim().toUpperCase().replace(/[\s-]/g, '');
  const embedded = /^[A-Z]/.test(flightNumber) && flightNumber.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
  const code = embedded ? embedded[1] : airline;
  const number = embedded ? embedded[2] : flightNumber.replace(/^0+(?=\d)/, '');
  return { airline: code, number, flight: `${code}${number}` };
}

function normalizeRegionalFlightRow(raw, source, airport, today) {
  const isTsa = airport === 'RCSS';
  const isTca = airport === 'RCMQ';
  const direction = isTsa
    ? String(raw.AirFlyIO || '') === '2' ? 'A' : 'D'
    : isTca
      ? String(raw.airFlyIO || '') === '2' ? 'A' : 'D'
      : source.direction;
  const date = regionalDate(isTsa ? raw.AirFlyDate : isTca ? raw.airFlyDate : today, today);
  const time = regionalTime(direction === 'D'
    ? (isTsa ? raw.ExpectDepartureTime : isTca ? raw.expectDepartureTime : raw.expectTime)
    : (isTsa ? raw.ExpectArrivalTime : isTca ? raw.expectArrivalTime : raw.expectTime));
  const estimatedTime = regionalTime(direction === 'D'
    ? (isTsa ? raw.RealDepartureTime : isTca ? raw.realDepartureTime : raw.realTime)
    : (isTsa ? raw.RealArrivalTime : isTca ? raw.realArrivalTime : raw.realTime));
  const identity = regionalFlightIdentity(
    isTsa ? raw.AirLineIATA : isTca ? raw.AirLineIATA : raw.airLineCode,
    isTsa ? raw.AirLineNum : isTca ? raw.airLineNum : raw.airLineNum
  );
  const airportCode = String(direction === 'D'
    ? (isTsa ? raw.GoalAirportCode : isTca ? raw.goalAirportCode : raw.goalAirportCode)
    : (isTsa ? raw.UpAirportCode : isTca ? raw.upAirportCode : raw.upAirportCode) || '').trim().toUpperCase();
  const destination = String(direction === 'D'
    ? (isTsa ? raw.GoalAirportName : isTca ? raw.goalAirportName : raw.goalAirportName)
    : (isTsa ? raw.UpAirportName : isTca ? raw.upAirportName : raw.upAirportName) || '').trim();
  const gate = String((isTsa ? raw.AirBoardingGate : raw.airBoardingGate) || '').trim();
  return {
    flight: identity.flight,
    airline: identity.airline,
    airlineName: String(isTsa ? raw.AirLineName : isTca ? raw.airLineName : raw.airLineName || '').trim(),
    number: identity.number,
    terminal: '',
    direction,
    date,
    time,
    estimatedDate: estimatedTime ? date : '',
    estimatedTime,
    gate,
    gateSource: gate ? 'airport-official' : '',
    airportCode,
    destination,
    status: String(isTsa ? raw.AirFlyStatus : isTca ? raw.airFlyStatus : raw.airFlyStatus || '').trim()
  };
}

function normalizeRegionalTdxRows(rows) {
  return rows.map(row => ({
    flight: row.flight || `${row['航空公司代碼']}${row['班次']}`,
    airline: row.airline || row['航空公司代碼'],
    airlineName: row.airlineName || row['航空公司中文'] || '',
    number: row.number || row['班次'],
    terminal: row.terminal || row['航廈'] || '',
    direction: row.direction || row['方向'],
    date: row.date || row['表訂日期'],
    time: row.time || row['表訂時間'],
    estimatedDate: row.estimatedDate || row['預計日期'],
    estimatedTime: row.estimatedTime || row['預計時間'],
    gate: row.gate || row['機門'],
    gateSource: row.gate || row['機門'] ? 'tdx-official' : '',
    airportCode: row.airportCode || row['往來地點'],
    destination: row.destination || row['往來地點中文'] || row['往來地點'],
    status: row.status || row['航班動態中文'] || row['備註'] || ''
  }));
}

async function loadRegionalTdxRows(airport, env) {
  if (airport !== 'RCSS' || !env?.TDX_CLIENT_ID || !env?.TDX_CLIENT_SECRET) return [];
  const cached = regionalTdxAirportCache.get(airport);
  if (cached && Date.now() - cached.loadedAt < 30_000) return cached.rows;
  try {
    const token = await getTdxToken(env);
    if (!token) return [];
    const [departures, arrivals] = await Promise.all([
      fetchTdxAirportFids(token, 'D', 'TSA'),
      fetchTdxAirportFids(token, 'A', 'TSA')
    ]);
    const rows = [...normalizeRegionalTdxRows(departures), ...normalizeRegionalTdxRows(arrivals)];
    regionalTdxAirportCache.set(airport, { loadedAt: Date.now(), rows });
    return rows;
  } catch (_error) {
    return [];
  }
}

function regionalFlightKey(row) {
  return [row.flight, row.direction, row.date, row.time].join('|');
}

function regionalFlightDayKey(row) {
  return [row.flight, row.direction, row.date].join('|');
}

function regionalMinutes(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function inferRegionalArrivalGates(rows) {
  const departures = rows.filter(row => row.direction === 'D' && row.gate && row.date && row.time);
  return rows.map(row => {
    if (row.direction !== 'A' || row.gate || !row.date || !row.airline || !row.airportCode) return row;
    const arrivalMinutes = regionalMinutes(row.estimatedTime || row.time);
    if (arrivalMinutes === null) return row;
    const candidates = departures.map(departure => {
      if (departure.date !== row.date || departure.airline !== row.airline || departure.airportCode !== row.airportCode) return null;
      const departureMinutes = regionalMinutes(departure.time);
      if (departureMinutes === null || departureMinutes <= arrivalMinutes) return null;
      const turnaroundMinutes = departureMinutes - arrivalMinutes;
      if (turnaroundMinutes < 20 || turnaroundMinutes > 180 || /取消|cancel/i.test(departure.status || '')) return null;
      return { departure, turnaroundMinutes };
    }).filter(Boolean).sort((a, b) => a.turnaroundMinutes - b.turnaroundMinutes);
    if (!candidates.length) return row;
    const nearestMinutes = candidates[0].turnaroundMinutes;
    const nearest = candidates.filter(candidate => candidate.turnaroundMinutes <= nearestMinutes + 15);
    const gates = [...new Set(nearest.map(candidate => candidate.departure.gate))];
    if (gates.length !== 1) return row;
    return {
      ...row,
      gate: gates[0],
      gateSource: 'inferred-turnaround',
      gateBasisFlight: nearest[0].departure.flight
    };
  });
}

async function loadRegionalAirportFlights(airport, env) {
  const cached = regionalAirportFlightCache.get(airport);
  if (cached && Date.now() - cached.loadedAt < 30_000) return cached;
  const sources = REGIONAL_GATE_SOURCES[airport] || [];
  const results = await Promise.allSettled(sources.map(source => fetchUpstream(source.url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'CrewPortal-FlightGate/1.0' },
    cf: { cacheTtl: 15, cacheEverything: true }
  }).then(async response => {
    if (!response.ok) throw new Error(`${airport} official flight source failed (${response.status})`);
    return { source, payload: await response.json() };
  })));
  const rows = results.flatMap(result => result.status === 'fulfilled'
    ? regionalPayloadRows(result.value.payload).map(raw => normalizeRegionalFlightRow(raw, result.value.source, airport, taipeiNow().date))
    : []
  ).filter(row => row.flight && row.date && row.time);
  if (!rows.length) throw new Error(`${GATE_AIRPORTS[airport].name}官方即時航班資料暫時無法取得`);
    // Keep the public regional lookup on the airport's official feed. TDX
    // Airport FIDS is intentionally not queried per user; its scheduled
    // fallback remains available through /api/flight-gate-tdx-source.
    const mergedRows = inferRegionalArrivalGates(rows);
  const source = {
    version: WORKER_VERSION,
    loadedAt: Date.now(),
    fetchedAt: Date.now(),
    source: `${GATE_AIRPORTS[airport].name}官方即時航班資料`,
    rows: mergedRows
  };
  regionalAirportFlightCache.set(airport, source);
  return source;
}

function normalizeCargoFlightIdentity(value) {
  const compact = String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
  const match = compact.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/) || compact.match(/^([A-Z]{3})(\d{1,4}[A-Z]?)$/);
  if (!match) return compact;
  const rawNumber = match[2];
  const suffix = /[A-Z]$/.test(rawNumber) ? rawNumber.slice(-1) : '';
  const digits = rawNumber.slice(0, rawNumber.length - suffix.length).replace(/^0+(?=\d)/, '');
  return `${match[1]}${digits}${suffix}`;
}

function cargoStandNumber(value) {
  const stand = Number.parseInt(String(value || '').trim(), 10);
  return Number.isInteger(stand) && stand >= RCTP_CARGO_STAND_MIN && stand <= RCTP_CARGO_STAND_MAX ? String(stand) : '';
}

function cargoDateTimeParts(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? { date: match[1], time: match[2] } : { date: '', time: '' };
}

function cargoDirectionLabel(value) {
  return String(value || '').toLowerCase() === 'arrival' ? '抵達' : '出發';
}

function cargoRoute(direction, origin, destination) {
  const from = String(origin || '').trim().toUpperCase();
  const to = String(destination || '').trim().toUpperCase();
  if (direction === '出發') return `TPE/${/^[A-Z0-9]{3}$/.test(to) ? to : '--'}`;
  return `${/^[A-Z0-9]{3}$/.test(from) ? from : '--'}/TPE`;
}

function normalizeWorkerTdxRows(rows) {
  return rows.map(row => ({
    flight: `${row['航空公司代碼']}${row['班次']}`,
    airline: row['航空公司代碼'],
    airlineName: row['航空公司中文'] || '',
    number: row['班次'],
    terminal: row['航廈'],
    direction: row['方向'],
    date: row['表訂日期'],
    time: row['表訂時間'],
    estimatedDate: row['預計日期'],
    estimatedTime: row['預計時間'],
    gate: row['機門'],
    airportCode: row['往來地點'],
    destination: row['往來地點中文'] || row['往來地點'],
    status: row['航班動態中文'] || row['備註'] || ''
  })).filter(row => row.flight && row.date && row.time);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some(value => String(value).trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); if (row.some(value => String(value).trim())) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows.shift().map(value => String(value).trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '').trim()])))
    .filter(row => Object.values(row).some(Boolean));
}

function normalizeOfficialCsvRows(rows) {
  return rows.map(row => {
    const airline = String(row['航空公司代碼'] || '').trim().toUpperCase();
    const number = String(row['班次'] || '').trim().replace(/^0+(?=\d)/, '');
    const date = String(row['表訂日期'] || '').trim().slice(0, 10);
    const time = String(row['表訂時間'] || '').trim().slice(0, 5);
    return {
      flight: `${airline}${number}`,
      airline,
      airlineName: String(row['航空公司中文'] || '').trim(),
      number,
      terminal: String(row['航廈'] || '').trim(),
      direction: String(row['方向'] || '').trim(),
      date,
      time,
      estimatedDate: String(row['預計日期'] || '').trim().slice(0, 10),
      estimatedTime: String(row['預計時間'] || '').trim().slice(0, 5),
      gate: String(row['機門'] || '').trim(),
      airportCode: String(row['往來地點'] || '').trim().toUpperCase(),
      destination: String(row['往來地點中文'] || row['往來地點'] || '').trim(),
      status: String(row['航班動態中文'] || row['備註'] || '').trim()
    };
  }).filter(row => row.airline && row.number && row.date && row.time);
}

function flightRowKey(row) {
  return [row.flight, row.direction, row.date, row.time, row.airportCode].map(value => String(value || '').trim().toUpperCase()).join('|');
}

function isCompletedFlightRow(row) {
  const status = String(row.status || '').toUpperCase();
  return /已飛|DEPARTED|已到|ARRIVED|抵達|取消|CANCEL/.test(status);
}

function flightRowMinutes(row) {
  const date = String(row.estimatedDate || row.date || '').trim();
  const time = String(row.estimatedTime || row.time || '').trim();
  if (date !== taipeiNow().date || !/^\d{2}:\d{2}$/.test(time)) return null;
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return Number.isFinite(minutes) ? minutes : null;
}

function sameDayContinuityRows(rows) {
  const now = taipeiNow();
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (row.date !== now.date) return false;
    if (isCompletedFlightRow(row)) return true;
    const minutes = flightRowMinutes(row);
    // Keep the current same-day schedule when TDX omits pending flights.
    // The four-hour look-back also covers a delayed or just-departed flight
    // without resurrecting an entire stale day's schedule.
    return minutes !== null && minutes >= now.minutes - 4 * 60;
  });
}

function mergeLiveFlightRows(liveRows, continuitySourceRows) {
  const merged = [...liveRows];
  const byKey = new Map(merged.map(row => [flightRowKey(row), row]));
  for (const row of sameDayContinuityRows(continuitySourceRows)) {
    const key = flightRowKey(row);
    const existing = byKey.get(key);
    if (existing) {
      // A live source wins when it has a value.  A previously confirmed gate,
      // status, or estimate fills a transient blank from TDX instead of
      // regressing a completed flight back to "未定".
      for (const field of ['gate', 'estimatedDate', 'estimatedTime', 'status', 'terminal', 'airlineName', 'destination']) {
        if (!existing[field] && row[field]) existing[field] = row[field];
      }
    } else {
      merged.push(row);
      byKey.set(key, row);
    }
  }
  return merged;
}

function mergeOfficialFlightRows(sources) {
  const merged = [];
  const byKey = new Map();
  for (const source of sources) {
    for (const row of Array.isArray(source.rows) ? source.rows : []) {
      const key = flightRowKey(row);
      const existing = byKey.get(key);
      if (!existing) {
        const copy = { ...row };
        merged.push(copy);
        byKey.set(key, copy);
        continue;
      }
      // Keep the ADIP row as the base, but fill blanks from TDX.
      for (const field of ['gate', 'estimatedDate', 'estimatedTime', 'status', 'terminal', 'airlineName', 'destination']) {
        if (!existing[field] && row[field]) existing[field] = row[field];
      }
    }
  }
  return merged;
}

function filterAmbiguousTdxRows(liveRows, routeBaselineRows) {
  const baseline = new Map();
  for (const row of Array.isArray(routeBaselineRows) ? routeBaselineRows : []) {
    const key = `${row.flight}|${row.date}`;
    if (!baseline.has(key)) baseline.set(key, new Set());
    baseline.get(key).add(flightRowKey(row));
  }
  const grouped = new Map();
  for (const row of liveRows) {
    const key = `${row.flight}|${row.date}`;
    if (!grouped.has(key)) grouped.set(key, new Set());
    grouped.get(key).add(flightRowKey(row));
  }
  return liveRows.filter(row => {
    const key = `${row.flight}|${row.date}`;
    const knownRoutes = baseline.get(key);
    if (knownRoutes?.size) return knownRoutes.has(flightRowKey(row));
    return grouped.get(key)?.size === 1;
  });
}

async function loadLiveAdipFlights(continuitySourceRows = []) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const rows = normalizeOfficialCsvRows(parseCsv(await fetchOfficialAdipCsv()));
      if (rows.length < 100 || !rows.some(row => row.gate)) throw new Error('Taoyuan official ADIP source returned insufficient flight data');
      return {
        version: WORKER_VERSION,
        loadedAt: Date.now(),
        fetchedAt: Date.now(),
        source: 'Taoyuan Airport ADIP official real-time flight data',
        continuityRows: 0,
        rows
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function fetchOfficialAdipCsv() {
  const targets = [
    { url: TPE_OFFICIAL_FLIGHT_SOURCE, cf: {} },
    ...TPE_OFFICIAL_FLIGHT_IPS.map(ip => ({
      url: TPE_OFFICIAL_FLIGHT_SOURCE,
      cf: { resolveOverride: ip }
    })),
    ...TPE_OFFICIAL_FLIGHT_IPS.map(ip => ({
      url: `https://${ip}/dataset/2025102001?format=csv`,
      headers: { Host: 'odp.taoyuan-airport.com' },
      cf: {}
    }))
  ];
  const attempts = targets.map(async target => {
      const response = await fetchUpstream(target.url, {
        headers: { 'Accept': 'text/csv,*/*', 'User-Agent': 'CrewPortal-FlightGate/1.0', ...(target.headers || {}) },
        cf: { cacheTtl: 0, cacheEverything: false, ...target.cf }
      });
      if (!response.ok) throw new Error(`Taoyuan official ADIP source failed (${response.status})`);
      const text = await response.text();
      if (text.length < 10_000 || !text.includes('機門')) throw new Error('Taoyuan official source returned invalid CSV');
      return text;
  });
  try {
    return await Promise.any(attempts);
  } catch (error) {
    const reasons = error?.errors?.map(item => String(item?.message || item)).filter(Boolean) || [];
    throw new Error(reasons.join('; ') || 'Taoyuan official ADIP source unavailable');
  }
}

async function loadLiveTdxFlights(env, ctx, continuitySourceRows = []) {
  const response = await handleFlightGateTdxSource(tdxAirportFidsCacheKey(), env, ctx);
  const payload = await response.json();
  const fetchedAt = Date.parse(payload.fetchedAtUtc);
  const liveRows = filterAmbiguousTdxRows(normalizeWorkerTdxRows(payload.rows || []), continuitySourceRows);
  if (!response.ok || !Number.isFinite(fetchedAt) || liveRows.length < 10 || !liveRows.some(row => row.gate)) {
    throw new Error(payload.error || 'TDX Airport FIDS returned insufficient gate data');
  }
  const rows = mergeLiveFlightRows(liveRows, continuitySourceRows);
  return {
    version: WORKER_VERSION,
    loadedAt: Date.now(),
    fetchedAt,
    source: 'TDX official Airport FIDS live fallback with same-day continuity',
    continuityRows: rows.length - liveRows.length,
    rows
  };
}

async function loadCombinedLiveFlights(env, ctx, continuitySourceRows = []) {
  const adipPromise = loadLiveAdipFlights(continuitySourceRows);
  try {
    // Keep user-triggered refreshes on the official ADIP source. TDX FIDS
    // remains a scheduled fallback only, so public traffic cannot multiply
    // TDX calls when the snapshot is stale.
    const first = await adipPromise;
    airportFlightCache = first;
    return first;
  } catch (error) {
    const reasons = error?.errors?.map(item => String(item?.message || item)).filter(Boolean) || [];
    throw new Error(reasons.join('; ') || 'Official live flight sources unavailable');
  }
}

function scheduleAirportFlightRefresh(env, ctx, continuitySourceRows) {
  if (airportFlightRefreshPromise) return airportFlightRefreshPromise;
  airportFlightRefreshPromise = loadCombinedLiveFlights(env, ctx, continuitySourceRows)
    .then(source => {
      airportFlightCache = source;
      return source;
    })
    .catch(() => null)
    .finally(() => { airportFlightRefreshPromise = null; });
  ctx?.waitUntil(airportFlightRefreshPromise);
  return airportFlightRefreshPromise;
}

async function loadAirportFlights(env, ctx, query = null) {
  if (airportFlightCache.rows && airportFlightCache.version === WORKER_VERSION && Date.now() - airportFlightCache.loadedAt < 60_000) {
    return airportFlightCache;
  }
  const sourceUrl = new URL(TPE_FLIGHT_SOURCE);
  sourceUrl.searchParams.set('v', `${WORKER_VERSION}-${Date.now()}`);
  let payload;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchUpstream(sourceUrl.toString(), {
        headers: { 'Accept': 'application/json', 'User-Agent': 'CrewPortal-FlightGate/1.0' },
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      if (!response.ok) throw new Error(`Taoyuan Airport flight source failed (${response.status})`);
      payload = await response.json();
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  if (!payload) throw new Error(`Taoyuan Airport flight source unavailable after 3 attempts: ${lastError?.message || lastError}`);
  if (!Array.isArray(payload.rows) || !payload.rows.length) throw new Error('Taoyuan Airport flight source returned no rows');
  airportFlightCache = {
    version: WORKER_VERSION,
    loadedAt: Date.now(),
    fetchedAt: Date.parse(payload.fetchedAtUtc) || Date.now(),
    source: payload.source || 'Taoyuan Airport ADIP official real-time flight data',
    continuityRows: Number(payload.quality?.continuityRows) || 0,
    rows: payload.rows
  };
  const snapshotAgeSeconds = Math.max(0, Math.floor((Date.now() - airportFlightCache.fetchedAt) / 1000));
  if (snapshotAgeSeconds > LIVE_FLIGHT_REFRESH_AGE_SECONDS) {
    const continuityRows = sameDayContinuityRows(airportFlightCache.rows);
    const hasRequestedCompletedContinuity = query && continuityRows.some(row =>
      row.airline === query.airline && row.number === query.number && isCompletedFlightRow(row) && Boolean(row.gate || row.stand)
    );
    if (hasRequestedCompletedContinuity) {
      return {
        ...airportFlightCache,
        loadedAt: Date.now(),
        source: 'Official live data unavailable; same-day continuity snapshot',
        continuityRows: continuityRows.length,
        rows: continuityRows
      };
    }
    // Do not make a user wait for a slow official refresh. Return the
    // available official snapshot immediately and refresh it in the
    // background for the next request.
    scheduleAirportFlightRefresh(env, ctx, airportFlightCache.rows);
    return {
      ...airportFlightCache,
      loadedAt: Date.now(),
      source: `${airportFlightCache.source || 'Official flight snapshot'}; live refresh pending`,
      continuityRows: continuityRows.length
    };
  }
  return airportFlightCache;
}

async function handleFlightGateSource(request) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const text = await fetchOfficialAdipCsv();
      const headers = new Headers(corsHeaders(request));
      headers.set('Content-Type', 'text/csv; charset=utf-8');
      headers.set('Cache-Control', 'public, max-age=30, s-maxage=60');
      return new Response(text, { headers });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  return json(request, {
    ok: false,
    source: 'Taoyuan Airport ADIP official real-time flight data',
    error: `Official source unavailable after 3 attempts: ${lastError?.message || lastError}`
  }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
}

async function handleCargoStand(request) {
  const url = new URL(request.url);
  const query = normalizeFlightQuery(url.searchParams.get('flight'));
  if (!query) return json(request, { ok: false, error: 'Invalid flight number. Use CI100, 5X61, or 100 (CI100).' }, { status: 400 });

  try {
    const response = await fetchUpstream(TPE_GOSS_CARGO_SOURCE, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'CrewPortal-CargoStand/1.0' },
      cf: { cacheTtl: 30, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`TPE GOSS cargo-stand source failed (${response.status})`);
    const payload = await response.json();
    const today = taipeiNow().date;
    const queryIdentity = `${query.airline}${query.number}`;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const seen = new Set();
    const matches = rows.map(row => {
      const direction = cargoDirectionLabel(row.flight_type);
      const dateTime = cargoDateTimeParts(row.scheduled_time);
      const estimated = cargoDateTimeParts(row.estimated_time);
      const identity = normalizeCargoFlightIdentity(row.flight_number);
      const airline = String(row.airline_code_iata || row.airline_code || '').trim().toUpperCase();
      const stand = cargoStandNumber(row.gate);
      return {
        flight: identity,
        airline,
        airlineName: String(row.airline_name || '').trim(),
        number: identity.startsWith(airline) ? identity.slice(airline.length) : identity,
        terminal: String(row.terminal || '').trim(),
        direction,
        date: dateTime.date,
        time: dateTime.time,
        estimatedDate: estimated.date,
        estimatedTime: estimated.time,
        stand,
        route: cargoRoute(direction, row.origin, row.destination),
        origin: String(row.origin || '').trim().toUpperCase(),
        destination: String(row.destination || '').trim().toUpperCase(),
        status: String(row.flight_status || '').trim(),
        aircraftType: String(row.aircraft_type || '').trim(),
        updatedAt: String(row.updated_at || row.last_contact || '').trim()
      };
    }).filter(row => row.flight === queryIdentity && row.date === today && row.stand);

    const uniqueMatches = matches.filter(row => {
      const key = [row.flight, row.direction, row.date, row.time, row.stand, row.origin, row.destination].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0, 12);

    return json(request, {
      ok: true,
      query: `${query.airline}${query.number}`,
      fetchedAt: new Date().toISOString(),
      source: 'TPE GOSS public ground-operations data',
      sourceUrl: TPE_GOSS_CARGO_SOURCE,
      standRange: `${RCTP_CARGO_STAND_MIN}-${RCTP_CARGO_STAND_MAX}`,
      matches: uniqueMatches
    }, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
  } catch (error) {
    return json(request, {
      ok: false,
      query: url.searchParams.get('flight') || '',
      source: 'TPE GOSS public ground-operations data',
      errorCode: 'CARGO_STAND_DATA_UNAVAILABLE',
      error: String(error?.message || error)
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

function tdxDatePart(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function tdxTimePart(value) {
  const match = String(value || '').match(/T(\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function tdxFlightNumber(row) {
  const raw = String(row.FlightNumber ?? row.FlightNo ?? '').replace(/\s+/g, '').toUpperCase();
  const airline = String(row.AirlineID ?? row.AirlineCode ?? '').trim().toUpperCase();
  const withoutAirline = airline && raw.startsWith(airline) ? raw.slice(airline.length) : raw;
  const numeric = withoutAirline.match(/^\d{1,4}[A-Z]?$/);
  const prefixed = raw.match(/^[A-Z]{2,3}(\d{1,4}[A-Z]?)$/);
  const number = numeric?.[0] || prefixed?.[1] || withoutAirline;
  return { airline, number: number.replace(/^0+(?=\d)/, '') };
}

function normalizeTdxAirportRows(rows, direction) {
  const dateField = direction === 'D' ? 'ScheduleDepartureTime' : 'ScheduleArrivalTime';
  const estimatedField = direction === 'D' ? 'EstimatedDepartureTime' : 'EstimatedArrivalTime';
  return rows.map(row => {
    const flight = tdxFlightNumber(row);
    const airportCode = direction === 'D'
      ? String(row.ArrivalAirportID ?? row.ArrivalAirportCode ?? '').trim().toUpperCase()
      : String(row.DepartureAirportID ?? row.DepartureAirportCode ?? '').trim().toUpperCase();
    return {
      '航空公司代碼': flight.airline,
      '航空公司中文': String(row.AirlineName ?? '').trim(),
      '班次': flight.number,
      '機門': String(row.Gate ?? '').trim(),
      '往來地點': airportCode,
      '往來地點中文': direction === 'D'
        ? String(row.ArrivalAirportName ?? '').trim()
        : String(row.DepartureAirportName ?? '').trim(),
      '航廈': String(row.Terminal ?? '').trim(),
      '方向': direction,
      '表訂日期': tdxDatePart(row[dateField]),
      '表訂時間': tdxTimePart(row[dateField]),
      '預計日期': tdxDatePart(row[estimatedField]),
      '預計時間': tdxTimePart(row[estimatedField]),
      '航班動態中文': String(row[direction === 'D' ? 'DepartureRemark' : 'ArrivalRemark'] ?? '').trim(),
      '備註': '',
    };
  }).filter(row => row['航空公司代碼'] && row['班次'] && row['表訂日期'] && row['表訂時間']);
}

async function fetchTdxAirportFids(token, direction, airportCode = 'TPE') {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchUpstream(`${TDX_AIRPORT_FIDS_ROOT}/${direction === 'D' ? 'Departure' : 'Arrival'}/${airportCode}?$format=JSON`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        cf: { cacheTtl: 30, cacheEverything: true }
      });
      if (!response.ok) throw new Error(`TDX airport FIDS failed (${response.status})`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.value || payload.data || [];
      if (!Array.isArray(rows)) throw new Error('TDX airport FIDS returned invalid rows');
      return normalizeTdxAirportRows(rows, direction);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1200));
    }
  }
  throw lastError;
}

async function handleFlightGateTdxSource(request, env, ctx) {
  const requestedAirport = normalizeGateAirport(new URL(request.url).searchParams.get('airport'));
  if (requestedAirport && requestedAirport !== 'RCTP') {
    const rows = await loadRegionalTdxRows(requestedAirport, env);
    return json(request, {
      ok: true,
      airport: requestedAirport,
      source: 'TDX official Airport FIDS real-time flight data',
      fetchedAtUtc: new Date().toISOString(),
      gateRows: rows.filter(row => row.gate).length,
      rows
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const cacheKey = tdxAirportFidsCacheKey();
    const edgeCached = await caches.default.match(cacheKey);
    if (edgeCached) return edgeCached;
    if (tdxAirportFidsCache.rows && Date.now() - tdxAirportFidsCache.loadedAt < TDX_FIDS_CACHE_BUCKET_SECONDS * 1000) {
      const response = json(request, {
        ok: true,
        source: 'TDX official Airport FIDS real-time flight data',
        fetchedAtUtc: new Date(tdxAirportFidsCache.loadedAt).toISOString(),
        rows: tdxAirportFidsCache.rows
      }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } });
      ctx?.waitUntil(caches.default.put(cacheKey, response.clone()));
      return response;
    }
    const token = await getTdxToken(env);
    if (!token) throw new Error('TDX credentials are not configured');
    const [departures, arrivals] = await Promise.all([
      fetchTdxAirportFids(token, 'D'),
      fetchTdxAirportFids(token, 'A')
    ]);
    const rows = [...departures, ...arrivals];
    if (rows.length < 10 || !rows.some(row => row['機門'])) throw new Error('TDX airport FIDS returned insufficient gate data');
    tdxAirportFidsCache = { loadedAt: Date.now(), rows };
    const response = json(request, {
      ok: true,
      source: 'TDX official Airport FIDS real-time flight data',
      fetchedAtUtc: new Date().toISOString(),
      rows
    }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } });
    ctx?.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    const previousCached = await caches.default.match(tdxAirportFidsCacheKey(-1));
    if (previousCached) return previousCached;
    return json(request, {
      ok: false,
      source: 'TDX official Airport FIDS real-time flight data',
      error: String(error?.message || error)
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

function flightFreshness(fetchedAt) {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000));
  const status = ageSeconds <= 15 * 60 ? 'fresh' : ageSeconds <= 45 * 60 ? 'delayed' : 'stale';
  return {
    status,
    ageSeconds,
    warning: status === 'fresh' ? '' : status === 'delayed'
      ? '官方航班資料更新延遲，登機門可能尚未是最新值'
      : '官方航班資料已過期，登機門請以機場或航空公司公告為準'
  };
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

function classifyDirectionFields(directionCode, destinationStationId, station) {
  directionCode = String(directionCode ?? '').trim();
  destinationStationId = normalizeStationId(destinationStationId);
  const stationIndex = stationNumber(station);
  const destinationIndex = stationNumber(destinationStationId);
  if (!['0', '1'].includes(directionCode) || stationIndex === null || destinationIndex === null) return null;

  // Official TYMC convention: 0 = southbound, 1 = northbound.
  // DestinationStationID validates the direction without reading display text.
  if (directionCode === '0' && destinationIndex > stationIndex) return 'zhongli';
  if (directionCode === '1' && destinationIndex < stationIndex) return 'taipei';
  return null;
}

function classifyDirection(record, station) {
  return classifyDirectionFields(
    tagValue(record, ['Direction']),
    tagValue(record, ['DestinationStationID', 'DestinationStaionID']),
    station
  );
}

function classifyTrainType(entry, record) {
  const raw = tagValue(entry, ['TrainType']) || tagValue(record, ['TrainType']);
  const code = String(raw).trim().toLowerCase();
  // Official TYMC timetable values: 0/1 = commuter, 2 = express.
  if (code === '0' || code === '1' || code === 'commuter') return 'commuter';
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
    throw new Error('No upcoming trains in official structured timetable');
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

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function structuredRecords(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.value || payload?.StationTimeTables || payload?.StationTimeTable || payload?.data || [];
}

function jsonServiceRunsToday(record, weekday) {
  const source = record?.ServiceDay ?? record?.ServiceDays;
  if (!source) return true;
  const values = [];
  for (const item of asArray(source)) {
    if (typeof item === 'string' || typeof item === 'number') values.push(String(item));
    else if (item && typeof item === 'object') {
      for (const key of ['ServiceTag', 'ServiceTagName', 'Name', 'Code']) {
        if (item[key] !== undefined && item[key] !== null) values.push(String(item[key]));
      }
    }
  }
  const raw = values.join(' ').toLowerCase();
  if (!raw) return true;
  if (/平日|weekday|weekdays/.test(raw)) return !['Sat', 'Sun'].includes(weekday);
  if (/假日|例假日|holiday|weekend/.test(raw)) return ['Sat', 'Sun'].includes(weekday);
  const names = {
    Sun: ['sunday', 'sun', '日'], Mon: ['monday', 'mon', '一'], Tue: ['tuesday', 'tue', '二'],
    Wed: ['wednesday', 'wed', '三'], Thu: ['thursday', 'thu', '四'], Fri: ['friday', 'fri', '五'], Sat: ['saturday', 'sat', '六']
  }[weekday] || [];
  return names.some(name => raw.includes(name));
}

function parseStructuredTimetableRows(payload, station) {
  const now = taipeiNow();
  const records = structuredRecords(payload);
  const rows = [];
  let stationRecordCount = 0;
  let directionalRecordCount = 0;
  const seen = new Set();
  for (const record of records) {
    if (normalizeStationId(record?.StationID) !== station) continue;
    stationRecordCount += 1;
    if (!jsonServiceRunsToday(record, now.weekday)) continue;
    const direction = classifyDirectionFields(record.Direction, record.DestinationStationID ?? record.DestinationStaionID, station);
    if (!direction) continue;
    directionalRecordCount += 1;
    const entries = asArray(record.Timetables?.Timetable ?? record.Timetables ?? record.Timetable);
    for (const entry of entries) {
      const clock = parseClock(entry?.DepartureTime ?? entry?.ArrivalTime ?? entry?.Time ?? entry?.TrainTime);
      if (!clock) continue;
      const type = trainType(entry);
      if (!type) continue;
      const key = `${direction}:${type}:${clock.time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ direction, type, ...clock });
    }
  }
  return { rows, serviceDate: now.date, recordCount: records.length, stationRecordCount, directionalRecordCount };
}

async function requestTdxTimetable(station, token, ctx) {
  const cached = tdxTimetableCache.get(station);
  let parsed = cached && cached.expiresAt > Date.now() ? cached.value : null;
  const edgeCache = caches.default;
  const cacheKey = new Request(`${TDX_EDGE_CACHE_ORIGIN}/station-timetable/${encodeURIComponent(station)}`, { method: 'GET' });
  if (!parsed) {
    const cachedResponse = await edgeCache.match(cacheKey);
    if (cachedResponse) parsed = await cachedResponse.json();
  }
  if (!parsed) {
    const filter = encodeURIComponent(`StationID eq '${station}'`);
    const response = await fetch(`${TDX_TIMETABLE_ROOT}?$filter=${filter}&$format=JSON`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      cf: { cacheTtl: 1800, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`TDX StationTimeTable request failed (${response.status})`);
    const payload = await response.json();
    parsed = parseStructuredTimetableRows(payload, station);
    if (!parsed.rows.length) {
      throw new Error(`No official TDX StationTimeTable rows found for ${station} (records=${parsed.recordCount}, stationRecords=${parsed.stationRecordCount}, directionalRecords=${parsed.directionalRecordCount})`);
    }
    const cacheResponse = new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' }
    });
    if (ctx?.waitUntil) ctx.waitUntil(edgeCache.put(cacheKey, cacheResponse));
  }
  tdxTimetableCache.set(station, { value: parsed, expiresAt: Date.now() + 15 * 60 * 1000 });
  return {
    trains: buildNextTrains(parsed.rows),
    serviceDate: parsed.serviceDate,
    sourceRows: parsed.rows.length,
    sourceRecords: parsed.recordCount,
    source: 'TDX StationTimeTable',
    officialUrl: `${TYM_OFFICIAL_TIMETABLE}${officialStationCode(station)}`,
    timetableParser: 'structured-official'
  };
}

async function requestOfficialTimetable(station, env, ctx) {
  let tdxError = null;
  try {
    const token = await getTdxToken(env);
    if (token) return await requestTdxTimetable(station, token, ctx);
  } catch (error) {
    tdxError = error;
  }
  try {
    return await requestOpenDataTimetable(station);
  } catch (error) {
    if (tdxError) throw new Error(`${error.message}; TDX StationTimeTable: ${tdxError.message}`);
    throw error;
  }
}

function trainType(row) {
  const code = String(row.TrainType ?? '').trim().toLowerCase();
  if (code === '2' || code === 'express') return 'express';
  if (code === '0' || code === '1' || code === 'commuter') return 'commuter';
  return null;
}
function trainDirection(row) {
  const directionCode = String(row.Direction ?? '').trim();
  const destinationStationId = normalizeStationId(row.DestinationStationID ?? row.DestinationStaionID);
  return classifyDirectionFields(directionCode, destinationStationId, row.StationID);
}

async function getTdxToken(env) {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) return null;
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const response = await fetchUpstream(TDX_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET })
  });
  if (!response.ok) throw new Error(`TDX token request failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error('TDX token response missing access_token');
  tokenCache = { token: data.access_token, expiresAt: Date.now() + Math.max(300, Number(data.expires_in) || 900) * 1000 };
  return tokenCache.token;
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
    const timetable = await requestOfficialTimetable(station, env, ctx);
    const payload = {
      ok: true,
      mode: 'timetable',
      station,
      source: 'Official structured timetable',
      sourceType: 'structured-official',
      timetableParser: 'structured-official',
      liveSource: null,
      fetchedAt: new Date().toISOString(),
      live: null,
      ...timetable
    };
    if (!debug) { delete payload.sourceRows; delete payload.sourceRecords; }
    const response = json(request, payload, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
    if (!debug) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return json(request, {
      ok: false, mode: 'unavailable', station, source: 'Official structured timetable',
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

async function handleFlightGate(request, env, ctx) {
  const url = new URL(request.url);
  const airport = normalizeGateAirport(url.searchParams.get('airport'));
  if (!airport) return json(request, { ok: false, error: 'Invalid airport. Use RCTP, RCSS, RCMQ, or RCKH.' }, { status: 400 });
  const query = normalizeFlightQuery(url.searchParams.get('flight'));
  if (!query) return json(request, { ok: false, error: 'Invalid flight number. Use CI100 or 100.' }, { status: 400 });

  try {
    const now = taipeiNow();
    const source = airport === 'RCTP'
      ? await loadAirportFlights(env, ctx, query)
      : await loadRegionalAirportFlights(airport, env);
    const airportInfo = GATE_AIRPORTS[airport];
    const freshness = flightFreshness(source.fetchedAt);
    const matches = source.rows
      .filter(row => row.date === now.date)
      .filter(row => (!query.airline || row.airline === query.airline) && row.number === query.number)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
      .slice(0, 6)
      .map(row => ({
        flight: `${row.airline}${row.number}`,
        airline: row.airline,
        airlineName: row.airlineName,
        terminal: row.terminal,
        direction: row.direction === 'A' ? '抵達' : row.direction === 'D' ? '出發' : row.direction,
        date: row.date,
        time: row.time,
        estimatedDate: row.estimatedDate,
        estimatedTime: row.estimatedTime,
        gate: row.gate,
        gateSource: row.gateSource || '',
        gateBasisFlight: row.gateBasisFlight || '',
        airportCode: row.airportCode,
        route: row.direction === 'D' ? `${airportInfo.iata}/${row.airportCode}` : `${row.airportCode}/${airportInfo.iata}`,
        destination: row.destination,
        status: row.status
      }));

    return json(request, {
      ok: true,
      airport,
      airportName: airportInfo.name,
      query: `${query.airline}${query.number}`,
      fetchedAt: new Date(source.fetchedAt).toISOString(),
      source: source.source || 'Taoyuan Airport ADIP official real-time flight data',
      freshness: freshness.status,
      dataAgeSeconds: freshness.ageSeconds,
      warning: freshness.warning,
      matches
    }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
  } catch (error) {
    const errorText = String(error?.message || error);
    const liveUnavailable = errorText.startsWith('Official live flight data unavailable:');
    return json(request, {
      ok: false,
      airport,
      airportName: GATE_AIRPORTS[airport].name,
      query: url.searchParams.get('flight') || '',
      source: GATE_AIRPORTS[airport].name + ' official real-time flight data',
      errorCode: liveUnavailable ? 'LIVE_FLIGHT_DATA_UNAVAILABLE' : 'FLIGHT_GATE_QUERY_FAILED',
      error: errorText
    }, { status: liveUnavailable ? 503 : 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== 'GET') return json(request, { ok: false, error: 'Method not allowed' }, { status: 405 });
    if (url.pathname === '/api/mrt') return handleMrt(request, env, ctx);
    if (url.pathname === '/api/flight-gate-source') return handleFlightGateSource(request);
    if (url.pathname === '/api/flight-gate-tdx-source') return handleFlightGateTdxSource(request, env, ctx);
    if (url.pathname === '/api/flight-gate') return handleFlightGate(request, env, ctx);
    if (url.pathname === '/api/cargo-stand') return handleCargoStand(request);
    if (url.pathname === '/api/parking' || url.pathname === '/') return handleParking(request);
    if (url.pathname === '/api/health') return json(request, {
      ok: true, service: 'Crew Portal API', version: WORKER_VERSION,
      workerVersion: WORKER_VERSION,
      portalVersion: PORTAL_VERSION,
      timetableSource: 'TDX StationTimeTable with Taoyuan City Government Open Data XML fallback',
      timetableParser: 'structured-official',
      cargoStandSource: 'TPE GOSS public ground-operations data',
      cargoStandRange: '501-525',
      tdxCredentialsConfigured: Boolean(env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET),
      liveBoardEnabled: false,
      timestamp: new Date().toISOString()
    });
    return json(request, { ok: false, error: 'Not found' }, { status: 404 });
  }
};
