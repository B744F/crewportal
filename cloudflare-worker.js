/**
 * Crew Portal API — Cloudflare Worker
 * Version 2.8.96 (Crew Portal v8.3.3)
 *
 * Primary MRT source: daily snapshot of Taoyuan Metro official timetable pages
 * Fallback MRT sources: live Taoyuan Metro official timetable page and TDX
 * HSR fallback sources: live THSRC official timetable search and TDX
 * TDX LiveBoard is intentionally disabled because the timetable is the
 * official data rendered by the portal and LiveBoard caused avoidable quota use.
 *
 * Required secrets for TDX timetable and Airport FIDS fallback:
 *   TDX_CLIENT_ID
 *   TDX_CLIENT_SECRET
 */

const PORTAL_VERSION = 'v8.3.3';
const WORKER_VERSION = '2.8.96';
const B744AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const B744AI_DAILY_REQUEST_LIMIT = 25;
const DEFAULT_FLIGHT_AIRLINE = 'CI';
const FLIGHT_UPSTREAM_TIMEOUT_MS = 7_000;
const LIVE_FLIGHT_REFRESH_AGE_SECONDS = 10 * 60;
const TDX_FIDS_CACHE_BUCKET_SECONDS = 5 * 60;
const PARKING_API = 'http://1.34.202.50:9130/parking_place/huahang';
const TPE_FLIGHT_SOURCES = [
  'https://b744f.github.io/crewportal/data/flight-gates.json',
  'https://raw.githubusercontent.com/B744F/crewportal/main/data/flight-gates.json'
];
const TPE_OFFICIAL_FLIGHT_FEED = 'https://www.taoyuan-airport.com/uploads/flightx/a_flight_v4.txt';
const TPE_ADIP_FLIGHT_SOURCE = 'https://odp.taoyuan-airport.com/dataset/2025102001?format=csv';
const TPE_OFFICIAL_FLIGHT_IPS = ['60.251.215.156', '60.251.184.156'];
const TPE_GOSS_CARGO_SOURCE = 'https://www.tpegoss.com/api/db/gates/schedule';
const RCTP_CARGO_STAND_MIN = 501;
const RCTP_CARGO_STAND_MAX = 525;
const TYM_OPEN_DATA_XML = 'https://opendata.tycg.gov.tw/api/dataset/8e6201c2-1968-4920-aba3-1a68093dab53/resource/83358afd-010a-4989-b63a-bbf20692e408/download';
const TYM_OFFICIAL_TIMETABLE = 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-';
const TDX_TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_TIMETABLE_ROOT = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/StationTimeTable/TYMC';
const TDX_THSR_DAILY_TIMETABLE_ROOT = 'https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/Today';
const THSRC_SNAPSHOT_URL = 'https://raw.githubusercontent.com/B744F/crewportal/main/data/hsr-timetable.json';
const THSRC_SEARCH_URL = 'https://www.thsrc.com.tw/TimeTable/Search';
const THSRC_SOURCE_PAGE = 'https://www.thsrc.com.tw/ArticleContent/a3b630bb-1066-4352-a1ef-58c7b4e8ef7c';
const MRT_SNAPSHOT_URL = 'https://raw.githubusercontent.com/B744F/crewportal/main/data/mrt-timetable.json';
const TDX_AIRPORT_FIDS_ROOT = 'https://tdx.transportdata.tw/api/basic/v2/Air/FIDS/Airport';
const ATIS_INFO_API = 'https://atis.info/api';
const ATIS_INFO_PAGE = 'https://atis.info';
const COFFEE_ATIS_API = 'https://info.coffeeteaorme.vip/api/atis-proxy';
const COFFEE_ATIS_PAGE = 'https://info.coffeeteaorme.vip/Public-D-ATIS';
const ATIS_GURU_PAGE = 'https://atis.guru/atis';
const ATIS_STALE_AFTER_MS = 90 * 60 * 1000;
const GATE_AIRPORTS = {
  RCTP: { icao: 'RCTP', iata: 'TPE', name: '桃園國際機場' },
  RCSS: { icao: 'RCSS', iata: 'TSA', name: '臺北松山機場' },
  RCMQ: { icao: 'RCMQ', iata: 'RMQ', name: '臺中國際機場' },
  RCKH: { icao: 'RCKH', iata: 'KHH', name: '高雄國際機場' }
};
const THSR_STATIONS = {
  '0990': '南港站', '1000': '台北站', '1010': '板橋站', '1020': '桃園站',
  '1030': '新竹站', '1035': '苗栗站', '1040': '台中站', '1043': '彰化站',
  '1047': '雲林站', '1050': '嘉義站', '1060': '台南站', '1070': '左營站'
};
const THSR_STATION_EN = {
  '0990': 'NanGang', '1000': 'TaiPei', '1010': 'BanQiao', '1020': 'TaoYuan',
  '1030': 'Hsinchu', '1035': 'Miaoli', '1040': 'Taichung', '1043': 'Changhua',
  '1047': 'Yunlin', '1050': 'Chiayi', '1060': 'Tainan', '1070': 'ZuoYing'
};
const THSRC_STATION_CODES = {
  '01': '0990', '02': '1000', '03': '1010', '04': '1020', '05': '1030', '06': '1035',
  '07': '1040', '08': '1043', '09': '1047', '10': '1050', '11': '1060', '12': '1070'
};
const THSR_STATION_ORDER = ['0990', '1000', '1010', '1020', '1030', '1035', '1040', '1043', '1047', '1050', '1060', '1070'];
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
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
]);

let tokenCache = { token: '', expiresAt: 0 };
const tdxTimetableCache = new Map();
let mrtSnapshotCache = { loadedAt: 0, serviceDate: '', stations: null };
let tdxHsrCache = { loadedAt: 0, serviceDate: '', rows: [] };
const thsrcHsrCache = new Map();
let thsrcSnapshotCache = { loadedAt: 0, serviceDate: '', stations: null };
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function handleB744AiStatus(request, env) {
  let manualCount = 0;
  if (env.B744AI_DB) {
    try {
      const row = await env.B744AI_DB.prepare('SELECT COUNT(*) AS count FROM b744ai_manuals WHERE active = 1').first();
      manualCount = Number(row?.count || 0);
    } catch (_error) {
      manualCount = 0;
    }
  }
  return json(request, {
    ok: true,
    service: 'B744 AI',
    version: '0.2.0',
    setupRequired: !env.B744AI_DB || manualCount === 0,
    manualCount,
    aiReady: Boolean(env.B744AI_DB && env.AI),
    accessMode: 'unlisted-link',
    freeTierMode: true
  }, { headers: { 'Cache-Control': 'no-store' } });
}

function b744AiSearchTerms(question) {
  const normalized = String(question || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u0000-\u001f"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const procedureCodes = normalized.match(/\b\d{2}-\d{2}-\d{2,3}\b/g) || [];
  if (procedureCodes.length) return [...new Set(procedureCodes)].slice(0, 4);
  const terms = [];
  const seen = new Set();
  const add = term => {
    if (term.length < 3 || seen.has(term)) return;
    seen.add(term);
    terms.push(term);
  };
  for (const segment of normalized.match(/[a-z0-9-]{3,}|[\u3400-\u9fff]{3,}/g) || []) {
    if (/^[\u3400-\u9fff]+$/.test(segment) && segment.length > 4) {
      for (let index = 0; index <= segment.length - 3 && terms.length < 10; index += 2) add(segment.slice(index, index + 3));
    } else {
      add(segment);
    }
    if (terms.length >= 10) break;
  }
  return terms;
}

function b744AiExcerpt(text, terms, limit = 1200) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const lowered = source.toLocaleLowerCase();
  const positions = terms.map(term => lowered.indexOf(term)).filter(position => position >= 0);
  const first = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, first - 220);
  return source.slice(start, start + limit);
}

function b744AiMapSource(row, terms) {
  return {
    manualId: row.manualId,
    shortTitle: row.shortTitle,
    title: row.title,
    revision: row.revision,
    effectiveDate: row.effectiveDate,
    pdfPage: Number(row.pdfPage),
    printedLabel: row.printedLabel || '',
    chapter: row.chapter || '',
    excerpt: b744AiExcerpt(row.sourceText, terms)
  };
}

async function searchB744AiSources(env, question, manualIds) {
  const terms = b744AiSearchTerms(question);
  if (!terms.length) return [];
  const allowed = new Set(['b744_fcom_r82', 'b744_qrh_r82', 'b744_mel_r51', 'b744_fctm_r16', 'fom_r52']);
  const selected = Array.isArray(manualIds) ? manualIds.filter(id => allowed.has(id)) : [];
  const manualFilter = selected.length ? ` AND b744ai_pages_fts.manual_id IN (${selected.map(() => '?').join(',')})` : '';
  const expression = terms.map(term => `"${term}"`).join(' OR ');
  const result = await env.B744AI_DB.prepare(`
    SELECT b744ai_pages_fts.manual_id AS manualId,
           b744ai_pages_fts.pdf_page AS pdfPage,
           b744ai_pages_fts.printed_label AS printedLabel,
           b744ai_pages_fts.chapter AS chapter,
           b744ai_pages_fts.source_text AS sourceText,
           b744ai_manuals.short_title AS shortTitle,
           b744ai_manuals.title AS title,
           b744ai_manuals.revision AS revision,
           b744ai_manuals.effective_date AS effectiveDate,
           bm25(b744ai_pages_fts) AS score
    FROM b744ai_pages_fts
    JOIN b744ai_manuals ON b744ai_manuals.id = b744ai_pages_fts.manual_id
    WHERE b744ai_pages_fts MATCH ?
      AND b744ai_manuals.active = 1
      ${manualFilter}
    ORDER BY score
    LIMIT 8
  `).bind(expression, ...selected).all();
  const rows = result.results || [];
  const referencePenalty = row => /CROSS REFERENCE LIST|Table of Contents/i.test(String(row.sourceText || '')) ? 1 : 0;
  rows.sort((left, right) => referencePenalty(left) - referencePenalty(right) || Number(left.score) - Number(right.score));

  const sources = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.manualId}:${row.pdfPage}`;
    if (!seen.has(key)) {
      sources.push(b744AiMapSource(row, terms));
      seen.add(key);
    }
    if (/Continued on the following page/i.test(String(row.sourceText || ''))) {
      const nextPage = String(Number(row.pdfPage) + 1);
      const continuation = await env.B744AI_DB.prepare(`
        SELECT manual_id AS manualId, pdf_page AS pdfPage, printed_label AS printedLabel,
               chapter, source_text AS sourceText
        FROM b744ai_pages_fts
        WHERE manual_id = ? AND pdf_page = ?
        LIMIT 1
      `).bind(row.manualId, nextPage).first();
      if (continuation) {
        const continuationKey = `${row.manualId}:${continuation.pdfPage}`;
        if (!seen.has(continuationKey)) {
          sources.push(b744AiMapSource({ ...row, ...continuation, score: Number(row.score) + 0.001 }, terms));
          seen.add(continuationKey);
        }
      }
    }
  }
  return sources.slice(0, 10);
}

function b744AiSourceOnlyAnswer(sources, reason = '') {
  if (!sources.length) {
    return '目前有效手冊中沒有找到足夠的直接依據。請補充飛航階段、系統訊息、構型或更精確的關鍵字；在資料不足前，不建議據此作出操作或派遣決定。';
  }
  const lead = reason ? `${reason}\n\n` : '';
  return `${lead}已找到 ${sources.length} 筆可能相關的受控文件來源。請先核對下方章節與頁碼；AI整理暫時不可用時，不會自行推測解決方案。`;
}

function b744AiStructuredMelAnswer(sources) {
  const sourceIndex = sources.findIndex(source =>
    source.shortTitle === 'MEL/CDL' && /Repair Interval\s+Nbr Installed\s+Nbr Required\s+Procedure\s+Notify Dispatch/i.test(source.excerpt)
  );
  if (sourceIndex < 0) return '';
  const source = sources[sourceIndex];
  const match = source.excerpt.match(
    /Repair Interval\s+Nbr Installed\s+Nbr Required\s+Procedure\s+Notify Dispatch\s+([A-D])\s+(\d+)\s+(\d+)\s+((?:\([A-Z]\))+?)\s+(YES|NO)\s+(.+?)(?=\s+NOTE\s*:|\s+\([OM]\)\s+[A-Z]|$)/i
  );
  if (!match) return '';
  const [, repairInterval, installed, required, procedure, notifyDispatch, condition] = match;
  const citation = `[S${sourceIndex + 1}]`;
  return [
    '依目前找到的受控文件，以下欄位直接取自 MEL 原表：',
    `1. 放行條件（原文）：${condition.trim()} ${citation}`,
    `2. Repair Interval：${repairInterval.toUpperCase()} ${citation}`,
    `3. Nbr Installed：${installed}；Nbr Required：${required} ${citation}`,
    `4. Procedure：${procedure.toUpperCase()} ${citation}`,
    `5. Notify Dispatch：${notifyDispatch.toUpperCase()} ${citation}`
  ].join('\n');
}

async function consumeB744AiDailyRequest(env) {
  const usageDate = new Date().toISOString().slice(0, 10);
  const current = await env.B744AI_DB.prepare('SELECT ai_requests AS count FROM b744ai_daily_usage WHERE usage_date = ?').bind(usageDate).first();
  if (Number(current?.count || 0) >= B744AI_DAILY_REQUEST_LIMIT) return false;
  await env.B744AI_DB.prepare(`
    INSERT INTO b744ai_daily_usage (usage_date, ai_requests, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(usage_date) DO UPDATE SET
      ai_requests = ai_requests + 1,
      updated_at = excluded.updated_at
  `).bind(usageDate, new Date().toISOString()).run();
  return true;
}

async function handleB744AiAsk(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    return json(request, { ok: false, error: 'Forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!env.B744AI_DB) {
    return json(request, { ok: false, message: '手冊資料庫正在設定中。' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  let body;
  try {
    body = await request.json();
  } catch (_error) {
    return json(request, { ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const question = String(body?.question || '').trim();
  if (question.length < 3 || question.length > 600) {
    return json(request, { ok: false, message: '問題長度必須介於 3 到 600 個字元。' }, { status: 400 });
  }

  let sources;
  try {
    sources = await searchB744AiSources(env, question, body?.manualIds);
  } catch (_error) {
    return json(request, { ok: false, message: '受控手冊索引目前無法查詢。' }, { status: 503 });
  }
  if (!sources.length) {
    return json(request, { ok: true, mode: 'source-search', answer: b744AiSourceOnlyAnswer([]), sources: [] });
  }
  const structuredMelAnswer = b744AiStructuredMelAnswer(sources);
  if (structuredMelAnswer) {
    return json(request, { ok: true, mode: 'structured-source', answer: structuredMelAnswer, sources }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (!env.AI) {
    return json(request, { ok: true, mode: 'source-search', answer: b744AiSourceOnlyAnswer(sources, 'AI服務尚未啟用。'), sources });
  }
  if (!(await consumeB744AiDailyRequest(env))) {
    return json(request, {
      ok: true,
      mode: 'source-search',
      answer: b744AiSourceOnlyAnswer(sources, '今日免費AI額度保護上限已到，系統已自動切換為來源搜尋模式。'),
      sources
    });
  }

  const sourcePack = sources.map((source, index) => {
    const maintenancePage = /^.*\(M\)\s+MAINTENANCE/i.test(source.excerpt);
    const content = maintenancePage
      ? '此頁包含僅限合格維修人員執行的 (M) MAINTENANCE 程序；不得向組員轉錄、改寫或建議執行任何維修步驟，只能指出應由維修人員依原頁執行。'
      : source.excerpt;
    return [
      `[S${index + 1}] ${source.shortTitle} R${source.revision}`,
      `章節：${source.chapter || '未標示'}；PDF頁：${source.pdfPage}；印刷頁：${source.printedLabel || '未標示'}`,
      content
    ].join('\n');
  }).join('\n\n');
  const systemPrompt = `你是 B747-400F 組員使用的飛航決策支援助理。你只能根據 SOURCE PACK 回答，不得使用未提供的記憶補充規定、限制、數值、風險、程序或協調要求。\n\n回答規則：\n1. 先判斷資料是否足夠；不足時只提出最少必要的澄清問題。\n2. 回答最多五個簡短項目，每個項目最後都必須附上 [S1] 形式的來源編號。\n3. 回答 MEL 項目時，第一項優先完整整理原文中的放行條件；若同頁有 Repair Interval、Nbr Installed、Nbr Required、Procedure 或 Notify Dispatch，也應照原文列出，不得自行改名或省略。\n4. 沒有直接來源就明確寫「所提供來源未說明」，不可合理化推測。\n5. 清楚區分文件明文規定與你的整理，不得把 MEL 許可條件改寫成故障後的操作步驟。\n6. 不重新排列或補寫 QRH、記憶項目、維修程序或核准檢查表步驟；維修程序只說明存在並指向來源頁。\n7. 不重建表格或轉錄成組合數值；如來源含溫度、重量、時間或其他數值表，只提示使用者到來源頁核對原表。\n8. 緊急或非正常狀況要明確提醒以 QRH、核准檢查表、機上指示及公司程序為優先。\n9. 來源衝突、不確定或資料不足時直接說明，絕不猜測；不得臆測對貨物、系統或飛航安全的影響。\n10. 以繁體中文簡潔摘要，不要大段抄錄 SOURCE PACK，保留必要的英文專有名詞。`;

  try {
    const result = await env.AI.run(B744AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `組員問題：\n${question}\n\nSOURCE PACK：\n${sourcePack}` }
      ],
      max_tokens: 600,
      temperature: 0.1
    });
    const answer = String(result?.response || result?.result?.response || '').trim();
    if (!answer) throw new Error('empty model response');
    const groundedLines = answer.split('\n')
      .map(line => line.trim())
      .filter(line => /\[S\d+\]/.test(line))
      .slice(0, 5);
    const citations = [...groundedLines.join('\n').matchAll(/\[S(\d+)\]/g)].map(match => Number(match[1]));
    if (!groundedLines.length || citations.some(index => index < 1 || index > sources.length)) {
      throw new Error('ungrounded model response');
    }
    const groundedAnswer = `依目前找到的受控文件：\n${groundedLines.join('\n')}`;
    return json(request, { ok: true, mode: 'ai', model: B744AI_MODEL, answer: groundedAnswer, sources }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (_error) {
    return json(request, {
      ok: true,
      mode: 'source-search',
      answer: b744AiSourceOnlyAnswer(sources, '免費AI服務目前忙碌或額度已用完，系統已安全降級。'),
      sources
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
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

function parseCsvMatrix(text) {
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
  return rows;
}

function parseCsv(text) {
  const rows = parseCsvMatrix(text);
  if (rows.length < 2) return [];
  const headers = rows.shift().map(value => String(value).trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '').trim()])))
    .filter(row => Object.values(row).some(Boolean));
}

function normalizeOfficialLegacyRows(rows) {
  return rows.map(values => ({
    '航廈': values[0],
    '方向': values[1],
    '航空公司代碼': values[2],
    '航空公司中文': values[3],
    '班次': values[4],
    '機門': values[5],
    '表訂日期': values[6],
    '表訂時間': values[7],
    '預計日期': values[8],
    '預計時間': values[9],
    '往來地點': values[10],
    '往來地點英文': values[11],
    '往來地點中文': values[12],
    '航班動態中文': values[13]
  })).filter(row => Object.values(row).some(value => String(value || '').trim()));
}

function normalizeOfficialCsvRows(rows) {
  return rows.map(row => {
    const airline = String(row['航空公司代碼'] || '').trim().toUpperCase();
    const number = String(row['班次'] || '').trim().replace(/^0+(?=\d)/, '');
    const date = String(row['表訂日期'] || '').trim().slice(0, 10).replaceAll('/', '-');
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
      estimatedDate: String(row['預計日期'] || '').trim().slice(0, 10).replaceAll('/', '-'),
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
      const official = await fetchOfficialFlightRows();
      const rows = official.rows;
      if (rows.length < 100 || !rows.some(row => row.gate)) throw new Error('Taoyuan official source returned insufficient flight data');
      return {
        version: WORKER_VERSION,
        loadedAt: Date.now(),
        fetchedAt: Date.now(),
        source: official.source,
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

async function fetchOfficialLegacyFlightRows() {
  const response = await fetchUpstream(TPE_OFFICIAL_FLIGHT_FEED, {
    headers: { 'Accept': 'text/plain,*/*', 'User-Agent': 'CrewPortal-FlightGate/1.0' },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) throw new Error(`Taoyuan official a_flight_v4 source failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 10_000) throw new Error('Taoyuan official a_flight_v4 source returned insufficient data');
  const text = new TextDecoder('big5').decode(bytes);
  const rows = normalizeOfficialCsvRows(normalizeOfficialLegacyRows(parseCsvMatrix(text)));
  if (rows.length < 100 || !rows.some(row => row.gate)) {
    throw new Error('Taoyuan official a_flight_v4 source returned invalid flight rows');
  }
  return rows;
}

async function fetchOfficialAdipCsv() {
  const targets = [
    { url: TPE_ADIP_FLIGHT_SOURCE, cf: {} },
    ...TPE_OFFICIAL_FLIGHT_IPS.map(ip => ({
      url: TPE_ADIP_FLIGHT_SOURCE,
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

async function fetchOfficialFlightRows() {
  const errors = [];
  try {
    return {
      source: 'Taoyuan Airport official a_flight_v4 real-time flight data',
      rows: await fetchOfficialLegacyFlightRows()
    };
  } catch (error) {
    errors.push(String(error?.message || error));
  }
  try {
    const rows = normalizeOfficialCsvRows(parseCsv(await fetchOfficialAdipCsv()));
    if (rows.length < 100 || !rows.some(row => row.gate)) {
      throw new Error('Taoyuan official ADIP source returned insufficient flight data');
    }
    return { source: 'Taoyuan Airport ADIP official real-time flight data', rows };
  } catch (error) {
    errors.push(String(error?.message || error));
  }
  throw new Error(errors.join('; ') || 'Taoyuan official flight sources unavailable');
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
    // Keep user-triggered refreshes on the official airport sources. TDX FIDS
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
  let payload;
  let lastError;
  for (const source of TPE_FLIGHT_SOURCES) {
    const sourceUrl = new URL(source);
    sourceUrl.searchParams.set('v', `${WORKER_VERSION}-${Date.now()}`);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
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
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    }
    if (payload) break;
  }
  if (!payload) throw new Error(`Taoyuan Airport flight snapshot sources unavailable: ${lastError?.message || lastError}`);
  if (!Array.isArray(payload.rows) || !payload.rows.length) throw new Error('Taoyuan Airport flight source returned no rows');
  airportFlightCache = {
    version: WORKER_VERSION,
    loadedAt: Date.now(),
    fetchedAt: Date.parse(payload.fetchedAtUtc) || Date.now(),
    source: payload.source || 'Taoyuan Airport official real-time flight data',
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
      const official = await fetchOfficialFlightRows();
      return json(request, {
        ok: true,
        source: official.source,
        fetchedAtUtc: new Date().toISOString(),
        gateRows: official.rows.filter(row => row.gate).length,
        rows: official.rows
      }, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  return json(request, {
    ok: false,
    source: 'Taoyuan Airport official real-time flight data',
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

function htmlAttribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeXml(match[2]) : '';
}

function parseOfficialPageRows(page, station) {
  const now = taipeiNow();
  const inputTags = String(page || '').match(/<input\b[^>]*>/gi) || [];
  const dateInput = inputTags.find(tag => htmlAttribute(tag, 'id') === 'timetable_date');
  const pageDate = htmlAttribute(dateInput, 'value');
  if (pageDate !== now.date) {
    throw new Error(`Taoyuan Metro official page date mismatch for ${station} (${pageDate || 'missing'} != ${now.date})`);
  }

  const rows = [];
  const seenRows = new Set();
  const seenDirections = new Set();
  for (const table of String(page || '').matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)) {
    const attrs = table[1];
    if (!htmlAttribute(attrs, 'class').split(/\s+/).includes('time-table')) continue;
    const summary = htmlAttribute(attrs, 'summary');
    const direction = summary.includes('往台北') ? 'taipei' : summary.includes('中壢') ? 'zhongli' : '';
    if (!direction || seenDirections.has(direction)) continue;
    seenDirections.add(direction);

    for (const row of table[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const hourMatch = row[1].match(/<th\b[^>]*scope\s*=\s*(["'])row\1[^>]*>([\s\S]*?)<\/th>/i);
      const hour = hourMatch ? Number(decodeXml(hourMatch[2].replace(/<[^>]+>/g, ' ')).trim()) : NaN;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      for (const span of row[1].matchAll(/<span\b([^>]*)>\s*<i\b[^>]*>\s*(\d{1,2})\s*<\/i>/gi)) {
        const marker = htmlAttribute(span[1], 'class').match(/\b(des0[1-5])\b/i)?.[1]?.toLowerCase();
        const minute = Number(span[2]);
        if (!marker || !Number.isInteger(minute) || minute < 0 || minute > 59) continue;
        const type = ['des01', 'des02'].includes(marker) ? 'express' : 'commuter';
        const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const key = `${direction}:${type}:${time}`;
        if (seenRows.has(key)) continue;
        seenRows.add(key);
        rows.push({ direction, type, time, hour, minute });
      }
    }
  }
  const expectedDirections = station === 'A1' ? ['zhongli'] : station === 'A22' ? ['taipei'] : ['taipei', 'zhongli'];
  if (!rows.length || expectedDirections.some(direction => !seenDirections.has(direction))) {
    throw new Error(`Taoyuan Metro official page returned incomplete rows for ${station}`);
  }
  return { rows, serviceDate: now.date, recordCount: rows.length };
}

async function requestOfficialPageTimetable(station) {
  const officialUrl = `${TYM_OFFICIAL_TIMETABLE}${officialStationCode(station)}`;
  const response = await fetchUpstream(officialUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; CrewPortal MRT timetable fallback)'
    },
    cf: { cacheTtl: 300, cacheEverything: true }
  }, 15_000);
  if (!response.ok) throw new Error(`Taoyuan Metro official page failed (${response.status})`);
  const parsed = parseOfficialPageRows(await response.text(), station);
  return {
    trains: buildNextTrains(parsed.rows),
    serviceDate: parsed.serviceDate,
    sourceRows: parsed.rows.length,
    sourceRecords: parsed.recordCount,
    source: 'Taoyuan Metro official station timetable page',
    officialUrl,
    timetableParser: 'official-page-html'
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

function thsrRecords(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.value || payload?.DailyTimetables || payload?.DailyTimetable || payload?.data || [];
}

function thsrName(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (!value || typeof value !== 'object') return fallback;
  return String(value.Zh_tw || value.zh_tw || value.ZhTw || value.En || value.en || value.Name || fallback).trim() || fallback;
}

function parseThsrDailyRows(payload) {
  const rows = [];
  for (const record of thsrRecords(payload)) {
    const info = record?.DailyTrainInfo || record?.TrainInfo || record?.DailyTimetable?.DailyTrainInfo || record?.DailyTimetable?.TrainInfo || {};
    const stopTimes = record?.StopTimes || record?.DailyTimetable?.StopTimes || [];
    const stops = asArray(stopTimes).map(stop => {
      const stationId = normalizeStationId(stop?.StationID);
      const arrival = parseClock(stop?.ArrivalTime);
      const departure = parseClock(stop?.DepartureTime) || arrival;
      if (!stationId || !arrival && !departure) return null;
      return {
        stationId,
        stationName: thsrName(stop?.StationName, THSR_STATIONS[stationId] || stationId),
        stationNameEn: THSR_STATION_EN[stationId] || '',
        arrivalTime: arrival?.time || departure?.time || '',
        departureTime: departure?.time || arrival?.time || '',
        stopSequence: Number(stop?.StopSequence) || 0
      };
    }).filter(Boolean).sort((a, b) => a.stopSequence - b.stopSequence);
    if (stops.length < 2) continue;
    const trainNo = String(info.TrainNo || record?.TrainNo || '').trim();
    const serviceDate = String(record?.TrainDate || info?.TrainDate || '').trim();
    if (!trainNo) continue;
    const firstStation = THSR_STATION_ORDER.indexOf(stops[0].stationId);
    const lastStation = THSR_STATION_ORDER.indexOf(stops[stops.length - 1].stationId);
    const direction = lastStation > firstStation ? 'southbound' : 'northbound';
    rows.push({ trainNo, serviceDate, direction, stops });
  }
  return rows;
}

function buildHsrNextTrains(rows, station) {
  const now = taipeiNow().minutes;
  const byDirection = direction => rows
    .map(row => {
      const stop = row.stops.find(item => item.stationId === station);
      if (!stop) return null;
      const clock = parseClock(stop.departureTime || stop.arrivalTime);
      if (!clock) return null;
      return {
        trainNo: row.trainNo,
        direction: row.direction,
        departureTime: clock.time,
        departureMinutes: clock.hour * 60 + clock.minute,
        destinationStationId: row.stops[row.stops.length - 1].stationId,
        destinationName: row.stops[row.stops.length - 1].stationName,
        stops: row.stops
      };
    })
    .filter(Boolean)
    .filter(row => row.direction === direction && row.departureMinutes + 0.01 >= now)
    .sort((a, b) => a.departureMinutes - b.departureMinutes || a.trainNo.localeCompare(b.trainNo))
    .slice(0, 2)
    .map(({ departureMinutes, ...row }) => row);
  return { northbound: byDirection('northbound'), southbound: byDirection('southbound') };
}

function parseThsrcSearchRows(payload, direction, serviceDate, destinationId) {
  const trainItems = payload?.data?.DepartureTable?.TrainItem || [];
  const rows = [];
  for (const item of trainItems) {
    const stops = asArray(item?.StationInfo).map((info, index) => {
      const stationNo = String(info?.StationNo || '').trim().padStart(2, '0');
      const stationId = THSRC_STATION_CODES[stationNo];
      const departure = parseClock(info?.DepartureTime);
      const arrival = parseClock(info?.ArrivalTime);
      const time = departure || arrival;
      if (!stationId || !time) return null;
      return {
        stationId,
        stationName: String(info?.StationName || THSR_STATIONS[stationId] || stationId).trim(),
        stationNameEn: THSR_STATION_EN[stationId] || '',
        arrivalTime: arrival?.time || time.time,
        departureTime: departure?.time || time.time,
        stopSequence: THSR_STATION_ORDER.indexOf(stationId) >= 0 ? THSR_STATION_ORDER.indexOf(stationId) : index
      };
    }).filter(Boolean).sort((a, b) => {
      const result = a.stopSequence - b.stopSequence;
      return direction === 'northbound' ? -result : result;
    });
    const trainNo = String(item?.TrainNumber || '').trim();
    if (!trainNo || stops.length < 2 || !stops.some(stop => stop.stationId === destinationId)) continue;
    rows.push({
      trainNo,
      serviceDate: String(item?.RunDate || serviceDate).replaceAll('/', '-'),
      direction,
      stops
    });
  }
  return rows;
}

async function requestThsrcOfficialSearch(station) {
  const now = taipeiNow();
  const cacheKey = `live:${station}`;
  const cached = thsrcHsrCache.get(cacheKey);
  if (cached && cached.serviceDate === now.date && Date.now() - cached.loadedAt < 5 * 60 * 1000) return cached;
  const searches = [];
  if (station !== '0990') searches.push({ direction: 'northbound', destinationId: '0990', destination: 'NanGang' });
  if (station !== '1070') searches.push({ direction: 'southbound', destinationId: '1070', destination: 'ZuoYing' });
  const responses = await Promise.all(searches.map(async search => {
    const form = new URLSearchParams({
      SearchType: 'S',
      Lang: 'TW',
      StartStation: THSR_STATION_EN[station],
      EndStation: search.destination,
      OutWardSearchDate: now.date.replaceAll('-', '/'),
      OutWardSearchTime: '00:00',
      ReturnSearchDate: '',
      ReturnSearchTime: '',
      DiscountType: ''
    });
    const response = await fetchUpstream(THSRC_SEARCH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: 'https://www.thsrc.com.tw',
        Referer: THSRC_SOURCE_PAGE,
        'User-Agent': 'Mozilla/5.0 (compatible; CrewPortal official timetable fallback)',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: form.toString(),
      cf: { cacheTtl: 300, cacheEverything: true }
    }, 30_000);
    if (!response.ok) throw new Error(`THSRC official search failed (${response.status})`);
    const payload = await response.json();
    if (payload?.success !== true) throw new Error('THSRC official search returned unsuccessful response');
    return parseThsrcSearchRows(payload, search.direction, now.date, search.destinationId);
  }));
  const rows = responses.flat();
  if (!rows.length) throw new Error(`No upcoming THSRC official search rows found for ${station}`);
  const result = {
    loadedAt: Date.now(),
    serviceDate: now.date,
    rows,
    source: 'THSRC official timetable search live fallback',
    sourceType: 'official-website-live'
  };
  thsrcHsrCache.set(cacheKey, result);
  return result;
}

async function requestThsrcTimetable(station) {
  const now = taipeiNow();
  const cached = thsrcHsrCache.get(station);
  if (cached && cached.serviceDate === now.date && Date.now() - cached.loadedAt < 5 * 60 * 1000) return cached;
  if (!thsrcSnapshotCache.stations || thsrcSnapshotCache.serviceDate !== now.date || Date.now() - thsrcSnapshotCache.loadedAt >= 5 * 60 * 1000) {
    const response = await fetchUpstream(THSRC_SNAPSHOT_URL, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 300, cacheEverything: true }
    }, 15_000);
    if (!response.ok) throw new Error(`THSRC official timetable snapshot failed (${response.status})`);
    const snapshot = await response.json();
    if (snapshot?.serviceDate !== now.date || !snapshot?.stations || typeof snapshot.stations !== 'object') {
      throw new Error(`THSRC official timetable snapshot is stale (serviceDate=${snapshot?.serviceDate || 'missing'}, expected=${now.date})`);
    }
    thsrcSnapshotCache = { loadedAt: Date.now(), serviceDate: snapshot.serviceDate, stations: snapshot.stations };
  }
  const rows = asArray(thsrcSnapshotCache.stations?.[station]?.rows);
  if (!rows.length) throw new Error(`No upcoming THSRC timetable snapshot rows found for ${station}`);
  const result = {
    loadedAt: Date.now(),
    serviceDate: now.date,
    rows,
    source: 'THSRC official timetable search snapshot',
    sourceType: 'official-website-snapshot'
  };
  thsrcHsrCache.set(station, result);
  return result;
}

async function requestTdxHsrTimetable(env) {
  const now = taipeiNow();
  if (tdxHsrCache.rows.length && tdxHsrCache.serviceDate === now.date && Date.now() - tdxHsrCache.loadedAt < 5 * 60 * 1000) return tdxHsrCache;
  const token = await getTdxToken(env);
  if (!token) throw new Error('TDX credentials are not configured');
  const response = await fetchUpstream(`${TDX_THSR_DAILY_TIMETABLE_ROOT}?$format=JSON`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`TDX THSR DailyTimetable request failed (${response.status})`);
  const payload = await response.json();
  const rows = parseThsrDailyRows(payload);
  if (!rows.length) throw new Error('No official TDX THSR daily timetable rows found');
  tdxHsrCache = { loadedAt: Date.now(), serviceDate: now.date, rows };
  return tdxHsrCache;
}

async function requestHsrTimetable(env, station) {
  let snapshotError;
  try {
    return await requestThsrcTimetable(station);
  } catch (error) {
    snapshotError = error;
  }
  let liveError;
  try {
    return await requestThsrcOfficialSearch(station);
  } catch (error) {
    liveError = error;
  }
  try {
    const fallback = await requestTdxHsrTimetable(env);
    return {
      ...fallback,
      source: 'TDX Rail/THSR/DailyTimetable/Today (fallback after THSRC failure)',
      sourceType: 'tdx-structured-fallback'
    };
  } catch (tdxError) {
    throw new Error(`THSRC snapshot unavailable: ${snapshotError?.message || snapshotError}; official live search unavailable: ${liveError?.message || liveError}; TDX fallback unavailable: ${tdxError?.message || tdxError}`);
  }
}

async function handleHsr(request, env) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '1020').trim();
  if (!Object.prototype.hasOwnProperty.call(THSR_STATIONS, station)) return json(request, { ok: false, error: 'Invalid HSR station' }, { status: 400 });
  try {
    const timetable = await requestHsrTimetable(env, station);
    return json(request, {
      ok: true,
      mode: 'daily-timetable',
      station,
      stationName: THSR_STATIONS[station],
      serviceDate: timetable.serviceDate,
      source: timetable.source || 'THSRC official timetable search',
      sourceType: timetable.sourceType || 'official-website-structured',
      fetchedAt: new Date().toISOString(),
      trains: buildHsrNextTrains(timetable.rows, station)
    }, { headers: { 'Cache-Control': 'public, max-age=45, stale-while-revalidate=120' } });
  } catch (error) {
    return json(request, { ok: false, error: String(error?.message || error) }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
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

async function requestMrtSnapshot(station) {
  const now = taipeiNow();
  if (!mrtSnapshotCache.stations || mrtSnapshotCache.serviceDate !== now.date || Date.now() - mrtSnapshotCache.loadedAt >= 5 * 60 * 1000) {
    const response = await fetchUpstream(MRT_SNAPSHOT_URL, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 300, cacheEverything: true }
    }, 15_000);
    if (!response.ok) throw new Error(`Official MRT timetable snapshot failed (${response.status})`);
    const snapshot = await response.json();
    if (snapshot?.serviceDate !== now.date || !snapshot?.stations || typeof snapshot.stations !== 'object') {
      throw new Error(`Official MRT timetable snapshot is stale (serviceDate=${snapshot?.serviceDate || 'missing'}, expected=${now.date})`);
    }
    mrtSnapshotCache = { loadedAt: Date.now(), serviceDate: snapshot.serviceDate, stations: snapshot.stations };
  }
  const parsed = mrtSnapshotCache.stations?.[station] || mrtSnapshotCache.stations?.[normalizeStationId(station)];
  if (!parsed?.rows?.length) throw new Error(`No official MRT timetable snapshot rows found for ${station}`);
  return {
    trains: buildNextTrains(parsed.rows),
    serviceDate: mrtSnapshotCache.serviceDate,
    sourceRows: parsed.rows.length,
    sourceRecords: parsed.sourceRecords || 0,
    source: 'Taoyuan Metro official timetable snapshot',
    officialUrl: `${TYM_OFFICIAL_TIMETABLE}${officialStationCode(station)}`,
    timetableParser: 'structured-official-snapshot'
  };
}

async function requestOfficialTimetable(station, env, ctx) {
  let snapshotError = null;
  try {
    return await requestMrtSnapshot(station);
  } catch (error) {
    snapshotError = error;
  }

  let officialPageError = null;
  try {
    return await requestOfficialPageTimetable(station);
  } catch (error) {
    officialPageError = error;
  }

  let tdxError = null;
  try {
    const token = await getTdxToken(env);
    if (token) return await requestTdxTimetable(station, token, ctx);
    throw new Error('TDX credentials are not configured');
  } catch (error) {
    tdxError = error;
  }

  throw new Error([
    `MRT snapshot: ${snapshotError?.message || 'unavailable'}`,
    `official page: ${officialPageError?.message || 'unavailable'}`,
    `TDX fallback: ${tdxError?.message || 'unavailable'}`
  ].join('; '));
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
  // Cloudflare's edge cache does not reliably separate responses by Vary:
  // Origin here, so include the request origin in the cache key explicitly.
  // Otherwise a local test response can be served to the production portal.
  const origin = request.headers.get('Origin') || 'no-origin';
  cacheUrl.search = `station=${station}&slot=${Math.floor(Date.now() / 60_000)}&origin=${encodeURIComponent(origin)}`;
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

function normalizeAtisAirport(value) {
  const airport = String(value || '').trim().toUpperCase();
  return /^[A-Z]{4}$/.test(airport) ? airport : null;
}

function isAmericanAtisAirport(airport) {
  return airport.startsWith('K')
    || /^(PA|PF|PH|PG|PO|PP|PW)/.test(airport)
    || ['TJSJ', 'TIST', 'TISX'].includes(airport);
}

function atisRoute(airport) {
  if (isAmericanAtisAirport(airport)) {
    return {
      id: 'atis.info',
      label: 'ATIS.info · FAA Digital ATIS',
      pageUrl: `${ATIS_INFO_PAGE}/${airport}`,
      apiUrl: `${ATIS_INFO_API}/${airport}`
    };
  }
  if (airport === 'RCTP' || airport === 'RJAA') {
    return {
      id: 'coffeeteaorme',
      label: 'CoffeeTeaOrMe · ACARS D-ATIS',
      pageUrl: `${COFFEE_ATIS_PAGE}/${airport}`,
      apiUrl: `${COFFEE_ATIS_API}?mode=public&text=${airport}`
    };
  }
  return {
    id: 'atis.guru',
    label: 'ATIS.guru · Live digital ATIS',
    pageUrl: `${ATIS_GURU_PAGE}/${airport}`,
    apiUrl: `${ATIS_GURU_PAGE}/${airport}`
  };
}

function parseAtisDate(value, now = new Date()) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(raw)) return direct;
  const compact = raw.match(/\b(\d{2})(\d{2})Z\b/i);
  if (!compact) return null;
  const hour = Number(compact[1]);
  const minute = Number(compact[2]);
  if (hour > 23 || minute > 59) return null;
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
  if (candidate.getTime() > now.getTime() + 15 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() - 1);
  return candidate;
}

function atisAge(dataTime, now = new Date()) {
  if (!dataTime) return { status: 'unavailable', stale: true, ageMinutes: null, validForCurrentUse: false };
  const ageMs = Math.max(0, now.getTime() - dataTime.getTime());
  const ageMinutes = Math.floor(ageMs / 60000);
  const stale = ageMs > ATIS_STALE_AFTER_MS;
  return {
    status: stale ? 'stale' : 'fresh',
    stale,
    ageMinutes,
    validForCurrentUse: !stale
  };
}

function parseCoffeeTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(/Z$|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestCoffeeAtis(payload, airport, now) {
  const records = Array.isArray(payload?.data) ? payload.data : [];
  const matches = records
    .filter(item => /\b(?:ARR|DEP)\s+ATIS\b/i.test(String(item?.message || item?.displayMessage || item?.rawMessage || '')))
    .sort((a, b) => (parseCoffeeTimestamp(b?.timestamp)?.getTime() || 0) - (parseCoffeeTimestamp(a?.timestamp)?.getTime() || 0));
  const latest = matches[0];
  if (!latest) return { dataTime: null, observedAt: null, recordCount: 0 };
  const message = String(latest.message || latest.displayMessage || latest.rawMessage || '');
  const scopedMessage = message.match(new RegExp(`${airport}\\s+(?:ARR|DEP)\\s+ATIS[\\s\\S]*`, 'i'))?.[0] || message;
  const issuedAt = parseAtisDate(scopedMessage, now);
  const observedAt = parseCoffeeTimestamp(latest.timestamp);
  return {
    dataTime: issuedAt || observedAt,
    observedAt,
    recordCount: matches.length
  };
}

function decodeHtmlText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function latestGuruAtis(html, airport, now) {
  const records = [];
  const pattern = /<div[^>]*class=["'][^"']*\batis\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = pattern.exec(String(html || ''))) !== null) {
    const text = decodeHtmlText(match[1]);
    if (new RegExp(`${airport}\\s+(?:ARR|DEP)\\s+ATIS\\b`, 'i').test(text)) records.push(text);
  }
  const unique = [...new Set(records)];
  unique.sort((a, b) => (parseAtisDate(b, now)?.getTime() || 0) - (parseAtisDate(a, now)?.getTime() || 0));
  const dataTime = unique.length ? parseAtisDate(unique[0], now) : null;
  return { dataTime, observedAt: null, recordCount: unique.length };
}

function atisResult(request, airport, route, now, details) {
  const dataTime = details.dataTime;
  const freshness = atisAge(dataTime, now);
  return json(request, {
    ok: true,
    airport,
    source: route.label,
    sourceUrl: route.pageUrl,
    route: route.id,
    checkedAt: now.toISOString(),
    dataTime: dataTime?.toISOString() || null,
    observedAt: details.observedAt?.toISOString() || null,
    recordCount: details.recordCount || 0,
    ...freshness,
    notice: freshness.status === 'stale'
      ? '資料已過期，不可視為目前有效 ATIS。'
      : freshness.status === 'fresh'
        ? '資料時間在 freshness window 內。'
        : '來源目前沒有可解析的 ATIS，無法確認目前有效資料。'
  }, { headers: { 'Cache-Control': 'no-store' } });
}

async function handleAtis(request) {
  const url = new URL(request.url);
  const airport = normalizeAtisAirport(url.searchParams.get('airport'));
  if (!airport) return json(request, { ok: false, error: '請輸入四碼 ICAO 機場代碼' }, { status: 400 });
  const route = atisRoute(airport);
  const now = new Date();
  try {
    if (route.id === 'atis.info') {
      const response = await fetchUpstream(route.apiUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) return atisResult(request, airport, route, now, { dataTime: null, recordCount: 0 });
      const payload = await response.json();
      const record = Array.isArray(payload) ? payload[0] : null;
      const message = String(record?.datis || record?.message || '');
      const issuedAt = parseAtisDate(message, now);
      const observedAt = parseAtisDate(record?.updatedAt, now) || parseAtisDate(record?.time ? `${record.time}Z` : '', now);
      return atisResult(request, airport, route, now, {
        dataTime: observedAt || issuedAt,
        observedAt,
        recordCount: record ? 1 : 0
      });
    }
    if (route.id === 'coffeeteaorme') {
      const response = await fetchUpstream(route.apiUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) return atisResult(request, airport, route, now, { dataTime: null, recordCount: 0 });
      return atisResult(request, airport, route, now, latestCoffeeAtis(await response.json(), airport, now));
    }
    const response = await fetchUpstream(route.apiUrl, { headers: { Accept: 'text/html' } }, 15_000);
    if (!response.ok) return atisResult(request, airport, route, now, { dataTime: null, recordCount: 0 });
    return atisResult(request, airport, route, now, latestGuruAtis(await response.text(), airport, now));
  } catch (error) {
    return json(request, {
      ok: false,
      airport,
      source: route.label,
      sourceUrl: route.pageUrl,
      route: route.id,
      error: 'ATIS 來源暫時無法查詢，未能確認資料新鮮度。',
      detail: String(error?.message || error)
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
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
      source: source.source || 'Taoyuan Airport official real-time flight data',
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

function visitorCountryCode(request) {
  const country = String(request.cf?.country || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : 'UN';
}

async function handleVisitorVisit(request, env) {
  const database = env.CREWPORTAL_VISITOR_STATS;
  if (!database) {
    return json(request, { ok: false, error: 'Visitor statistics database is not configured' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
  const countryCode = visitorCountryCode(request);
  const now = new Date().toISOString();
  try {
    await database.prepare(`
      INSERT INTO visitor_country_counts (country_code, visit_count, last_seen_at)
      VALUES (?1, 1, ?2)
      ON CONFLICT(country_code) DO UPDATE SET
        visit_count = visitor_country_counts.visit_count + 1,
        last_seen_at = excluded.last_seen_at
    `).bind(countryCode, now).run();
    return json(request, { ok: true }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
    });
  } catch (error) {
    return json(request, { ok: false, error: String(error?.message || error) }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

async function handleVisitorStats(request, env) {
  const database = env.CREWPORTAL_VISITOR_STATS;
  if (!database) {
    return json(request, { ok: false, error: 'Visitor statistics database is not configured' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
  try {
    const result = await database.prepare(`
      SELECT country_code AS countryCode, visit_count AS visitCount, last_seen_at AS lastSeenAt
      FROM visitor_country_counts
      ORDER BY visit_count DESC, country_code ASC
    `).all();
    const countries = result.results || [];
    const totalVisits = countries.reduce((sum, country) => sum + Number(country.visitCount || 0), 0);
    return json(request, {
      ok: true,
      totalVisits,
      countries,
      generatedAt: new Date().toISOString()
    }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
  } catch (error) {
    return json(request, { ok: false, error: String(error?.message || error) }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (url.pathname === '/api/b744ai/ask') {
      if (request.method !== 'POST') return json(request, { ok: false, error: 'Method not allowed' }, { status: 405 });
      return handleB744AiAsk(request, env);
    }
    if (url.pathname === '/api/b744ai/status') {
      if (request.method !== 'GET') return json(request, { ok: false, error: 'Method not allowed' }, { status: 405 });
      return handleB744AiStatus(request, env);
    }
    if (url.pathname === '/api/visit') {
      if (request.method !== 'POST') return json(request, { ok: false, error: 'Method not allowed' }, { status: 405 });
      return handleVisitorVisit(request, env);
    }
    if (request.method !== 'GET') return json(request, { ok: false, error: 'Method not allowed' }, { status: 405 });
    if (url.pathname === '/api/visitor-stats') return handleVisitorStats(request, env);
    if (url.pathname === '/api/atis') return handleAtis(request);
    if (url.pathname === '/api/hsr') return handleHsr(request, env);
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
      timetableSource: 'Taoyuan Metro official timetable snapshot with live official-page and TDX fallback',
      hsrTimetableSource: 'THSRC official timetable snapshot with live official search and TDX fallback',
      timetableParser: 'structured-official',
      flightGateSource: 'Taoyuan Airport official a_flight_v4 feed with ADIP and scheduled TDX fallback',
      cargoStandSource: 'TPE GOSS public ground-operations data',
      cargoStandRange: '501-525',
      atisSources: 'ATIS.info API for US regions; CoffeeTeaOrMe API for RCTP/RJAA; ATIS.guru with 90-minute freshness guard elsewhere',
      atisStaleAfterMinutes: 90,
      visitorStatsConfigured: Boolean(env.CREWPORTAL_VISITOR_STATS),
      b744AiDatabaseConfigured: Boolean(env.B744AI_DB),
      b744AiAccessMode: 'unlisted-link',
      b744AiFreeTierMode: true,
      tdxCredentialsConfigured: Boolean(env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET),
      liveBoardEnabled: false,
      timestamp: new Date().toISOString()
    });
    return json(request, { ok: false, error: 'Not found' }, { status: 404 });
  }
};
