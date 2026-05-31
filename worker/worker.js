/**
 * Help Wanted + UCF Class Tracker — Cloudflare Worker
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default {
  // ── HTTP REQUESTS ──────────────────────────────────────────────────────────
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      // UCF class search
      if (url.pathname === '/api/ucf') {
        return await handleUCFSearch(url.searchParams);
      }

      // Jobs (existing)
      if (url.pathname === '/api/jobs') return await handleJobSearch(url.searchParams, env);
      if (url.pathname.startsWith('/api/jobs/zip/')) {
        const zip = url.pathname.replace('/api/jobs/zip/', '').trim();
        return await handleZipJobs(zip, env);
      }
      if (url.pathname === '/api/meta') return await handleMeta(env);
      if (url.pathname === '/api/health') {
        return json({ status: 'ok', timestamp: new Date().toISOString() });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: 'Internal error', message: err.message }, 500);
    }
  },

  // ── CRON — runs every 10 minutes ───────────────────────────────────────────
  async scheduled(event, env, ctx) {
    // Refresh cached UCF data for any stored watchlists
    // (Phase 2 — notifications will go here)
    console.log('UCF cron tick:', new Date().toISOString());
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// UCF CLASS SEARCH
// ─────────────────────────────────────────────────────────────────────────────

async function handleUCFSearch(params) {
  const term     = params.get('term')    || '2268';
  const raw      = params.get('courses') || '';
  const courses  = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);

  if (!courses.length) return json({ error: 'Provide ?courses=COP3330,MAC2311&term=2268' }, 400);

  const results = await Promise.all(
    courses.map(async code => {
      const parsed = parseCourseCode(code);
      if (!parsed) return { course: code.toUpperCase(), error: 'Unrecognized course format', sections: [] };
      try {
        const data = await searchUCF(parsed.subject, parsed.number, term);
        return { course: code.toUpperCase(), ...data };
      } catch (e) {
        return { course: code.toUpperCase(), error: e.message, sections: [] };
      }
    })
  );

  return json({ results, term, timestamp: new Date().toISOString() });
}

function parseCourseCode(code) {
  const s = code.toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^([A-Z]{2,4})(\d{4}[A-Z]?)$/);
  return m ? { subject: m[1], number: m[2] } : null;
}

async function searchUCF(subject, number, term) {
  const BASE = 'https://my.ucf.edu/psp/IHPROD/GUEST/CSPROD/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL';
  const UA   = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  // ── Step 1: load search page, grab session tokens ─────────────────────────
  const r1 = await fetch(BASE, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
  });

  if (!r1.ok) throw new Error(`UCF returned HTTP ${r1.status} on initial load`);

  const html1     = await r1.text();
  const cookieHdr = r1.headers.get('set-cookie') || '';
  const cookies   = parseCookies(cookieHdr);

  const ICSID      = extractInput(html1, 'ICSID');
  const ICStateNum = extractInput(html1, 'ICStateNum') || '1';
  const ICInstDtm  = extractInput(html1, 'ICInstDtm')  || '';

  if (!ICSID) throw new Error('Could not get UCF session token — site may be down');

  // ── Step 2: POST the search form ──────────────────────────────────────────
  const body = new URLSearchParams({
    ICAJAX: '0', ICType: 'Panel', ICElementNum: '0',
    ICStateNum, ICAction: 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH',
    ICSaveWarningFilter: '0', ICChanged: '-1', ICResubmit: '0',
    ICSID, ICInstDtm,
    'CLASS_SRCH_WRK2_STRM$35$':       term,
    'CLASS_SRCH_WRK2_SUBJECT_SRCH$0': subject,
    'CLASS_SRCH_WRK2_CATALOG_NBR$1':  number,
    'CLASS_SRCH_WRK2_SSR_OPEN_ONLY$chk': 'N',
  });

  const r2 = await fetch(BASE, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': BASE,
    },
    body: body.toString(),
    redirect: 'follow',
  });

  if (!r2.ok) throw new Error(`UCF search returned HTTP ${r2.status}`);

  const html2 = await r2.text();
  return parseResults(html2, subject, number);
}

function extractInput(html, name) {
  const patterns = [
    new RegExp(`name=["']${name}["'][^>]*?value=["']([^"']*?)["']`, 'i'),
    new RegExp(`value=["']([^"']*?)["'][^>]*?name=["']${name}["']`, 'i'),
    new RegExp(`id=["']${name}["'][^>]*?value=["']([^"']*?)["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function parseCookies(setCookieHeader) {
  return setCookieHeader
    .split(/,(?=[^ ].*?=)/)
    .map(c => c.trim().split(';')[0].trim())
    .filter(c => c.includes('='))
    .join('; ');
}

function parseResults(html, subject, number) {
  // No results
  if (/no classes were found|no results found/i.test(html)) {
    return { found: false, sections: [], message: 'No classes found for this term' };
  }

  const sections = [];

  // ── Strategy 1: find PeopleSoft grid rows ─────────────────────────────────
  // Results rows usually have class PSLEVEL1GRIDROW or PSLEVEL2GRIDROW
  const rowRe = /<tr[^>]*class=["'][^"']*PSGRID[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html)) !== null) {
    const cells = extractCells(row[1]);
    if (cells.length >= 3) {
      const section = buildSection(cells);
      if (section) sections.push(section);
    }
  }

  // ── Strategy 2: scan for Open/Closed/Wait List with surrounding context ───
  if (sections.length === 0) {
    const statusRe = /(?:>|\s)(Open|Closed|Wait\s+List)(?:<|[\s,])/gi;
    let m;
    const seen = new Set();
    while ((m = statusRe.exec(html)) !== null) {
      const status = m[1].replace(/\s+/g, ' ').trim();
      // Get up to 400 chars before for context
      const before = html.substring(Math.max(0, m.index - 400), m.index);
      const text   = before.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      // Try to extract class number (5 digits), days/time
      const classNum = (text.match(/\b(\d{5})\b/) || [])[1] || '';
      const timeStr  = (text.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)?/i) || [])[0] || '';
      const days     = (text.match(/\b(MoWeFr|MoWe|TuTh|Mo|Tu|We|Th|Fr|Sa|Su){1,5}/i) || [])[0] || '';

      const key = classNum || (status + timeStr);
      if (!seen.has(key)) {
        seen.add(key);
        sections.push({ classNum, days, time: timeStr, status, seats: '' });
      }
    }
  }

  // ── Determine overall availability ────────────────────────────────────────
  const hasOpen     = sections.some(s => /open/i.test(s.status));
  const hasWaitlist = sections.some(s => /wait/i.test(s.status));
  const overall     = hasOpen ? 'Open' : hasWaitlist ? 'Waitlist' : sections.length ? 'Closed' : 'Unknown';

  return { found: sections.length > 0, overall, sections: sections.slice(0, 30), subject, number };
}

function extractCells(rowHtml) {
  const cells = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(rowHtml)) !== null) {
    cells.push(m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return cells;
}

function buildSection(cells) {
  let classNum = '', section = '', days = '', time = '', instructor = '', status = '', seats = '';
  for (const cell of cells) {
    if (/^\d{5}$/.test(cell))                         classNum   = cell;
    else if (/^[A-Z]\d{3}$/i.test(cell))              section    = cell;
    else if (/\d{1,2}:\d{2}/i.test(cell))             time       = cell;
    else if (/\b(Mo|Tu|We|Th|Fr|Sa|Su)/i.test(cell) && cell.length < 20) days = cell;
    else if (/^(Open|Closed|Wait\s+List)$/i.test(cell)) status   = cell;
    else if (/\d+ of \d+/i.test(cell))                seats      = cell;
    else if (cell.length > 3 && cell.length < 40 && /[A-Z]/.test(cell) && !instructor) instructor = cell;
  }
  if (!status && !classNum) return null;
  return { classNum, section, days, time, instructor, status: status || 'Unknown', seats };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOBS (existing functionality, unchanged)
// ─────────────────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function handleJobSearch(params, env) {
  const zip = params.get('zip');
  const lat = parseFloat(params.get('lat'));
  const lng = parseFloat(params.get('lng'));
  const radiusMiles = parseFloat(params.get('radius') || '25');
  const jobType = params.get('type') || '';
  const query = (params.get('q') || '').toLowerCase().trim();
  const limit = Math.min(parseInt(params.get('limit') || '100'), 200);

  let jobs = [];

  if (zip && zip.length === 5) {
    const zipData = await env.JOBS_KV.get('jobs:zip:' + zip, 'json');
    if (zipData && zipData.length > 0) jobs = zipData;
  }

  if (jobs.length === 0) jobs = await loadAllJobs(env);

  let userLat = (!isNaN(lat) && lat !== 0) ? lat : null;
  let userLng = (!isNaN(lng) && lng !== 0) ? lng : null;

  if (zip && zip.length === 5 && !userLat) {
    const zc = ZIP_COORDS[zip];
    if (zc) { userLat = zc[0]; userLng = zc[1]; }
  }

  if (userLat && userLng) {
    jobs = jobs.map(j => ({ ...j, distanceMiles: (j.lat && j.lng) ? haversine(userLat, userLng, j.lat, j.lng) : null }));
  }

  if (jobType) jobs = jobs.filter(j => (j.jobType || '').toLowerCase().includes(jobType.toLowerCase()));
  if (query)   jobs = jobs.filter(j => ((j.title||'')+(j.company||'')+(j.description||'')).toLowerCase().includes(query));

  jobs.sort((a, b) => ((a.distanceMiles ?? 9999) - (b.distanceMiles ?? 9999)));

  const seen = new Set();
  const unique = jobs.filter(j => {
    const key = j.id || (j.title + j.company);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  return json({ count: unique.length, jobs: unique.slice(0, limit), zip });
}

async function loadAllJobs(env) {
  const meta = await env.JOBS_KV.get('jobs:meta', 'json');
  const total = meta?.totalChunks || 3;
  const all = [];
  for (let i = 0; i < total; i++) {
    const chunk = await env.JOBS_KV.get('jobs:all:' + i, 'json');
    if (chunk && Array.isArray(chunk)) all.push(...chunk);
  }
  return all;
}

async function handleZipJobs(zip, env) {
  let jobs = await env.JOBS_KV.get('jobs:zip:' + zip, 'json');
  if (!jobs || !jobs.length) jobs = await loadAllJobs(env);
  return json({ count: jobs.length, jobs, zip });
}

async function handleMeta(env) {
  const meta = await env.JOBS_KV.get('jobs:meta', 'json');
  return json(meta || { lastUpdated: null, totalJobs: 0 });
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3959, dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 10) / 10;
}

function toRad(deg) { return deg * (Math.PI / 180); }

const ZIP_COORDS = {
  '10001':[40.7484,-74.0014],'10002':[40.7157,-73.9863],'11201':[40.6928,-73.9903],
  '90001':[33.9731,-118.2479],'90210':[34.0901,-118.4065],'60601':[41.8827,-87.6233],
  '77001':[29.7543,-95.3677],'85001':[33.4484,-112.0740],'19101':[39.9526,-75.1652],
  '78201':[29.4241,-98.4936],'92101':[32.7157,-117.1611],'75201':[32.7767,-96.7970],
  '95101':[37.3382,-121.8863],'94102':[37.7749,-122.4194],'98101':[47.6062,-122.3321],
  '80201':[39.7392,-104.9903],'02101':[42.3601,-71.0589],'30301':[33.7490,-84.3880],
  '32801':[28.5383,-81.3792],'33601':[27.9506,-82.4572],'32816':[28.6024,-81.2001],
};
