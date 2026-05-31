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
      async fetch(request, env, ctx) {
              const url = new URL(request.url);
              if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
              try {
                        if (url.pathname === '/api/ucf') return await handleUCFSearch(url.searchParams);
                        if (url.pathname === '/api/jobs') return await handleJobSearch(url.searchParams, env);
                        if (url.pathname.startsWith('/api/jobs/zip/')) {
                                    return await handleZipJobs(url.pathname.replace('/api/jobs/zip/','').trim(), env);
                        }
                        if (url.pathname === '/api/meta') return await handleMeta(env);
                        if (url.pathname === '/api/health') return json({ status: 'ok', timestamp: new Date().toISOString() });
                        return json({ error: 'Not found' }, 404);
              } catch (err) {
                        return json({ error: 'Internal error', message: err.message }, 500);
              }
      },

      async scheduled(event, env, ctx) {
              console.log('UCF cron tick:', new Date().toISOString());
      },
};

// — UCF SEARCH ——————————————————————————————————————————————————————

async function handleUCFSearch(params) {
      const term    = params.get('term')    || '2268';
      const courses = (params.get('courses') || '').split(',').map(s=>s.trim()).filter(Boolean).slice(0,20);
      if (!courses.length) return json({ error: 'Provide ?courses=COP3330,MAC2311&term=2268' }, 400);

  const results = await Promise.all(courses.map(async code => {
          const p = parseCourseCode(code);
          if (!p) return { course: code.toUpperCase(), error: 'Unrecognized format', sections: [] };
          try {
                    return await searchUCF(p.subject, p.number, term);
          } catch(e) {
                    return { course: code.toUpperCase(), error: e.message, sections: [] };
          }
  }));

  return json({ results, term, timestamp: new Date().toISOString() });
}

function parseCourseCode(code) {
      const m = code.toUpperCase().replace(/\s+/g,'').match(/^([A-Z]{2,4})(\d{4}[A-Z]?)$/);
      return m ? { subject: m[1], number: m[2] } : null;
}

// Uses UCF's public section API via my.ucf.edu PeopleSoft with improved session handling
async function searchUCF(subject, number, term) {
      const BASE = 'https://my.ucf.edu/psp/IHPROD/GUEST/CSPROD/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL';
      const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // Step 1: GET the page with full browser-like headers to get session tokens
  const r1 = await fetch(BASE, {
          headers: {
                    'User-Agent': UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0',
          },
          redirect: 'follow',
          cf: { cacheTtl: 0 },
  });

  if (!r1.ok) throw new Error(`UCF returned HTTP ${r1.status}`);

  const html1    = await r1.text();
      const cookies  = parseCookies(r1.headers.get('set-cookie') || '');
      const ICSID    = extractInput(html1, 'ICSID');
      const ICState  = extractInput(html1, 'ICStateNum') || '1';
      const ICInst   = extractInput(html1, 'ICInstDtm')  || '';

  if (!ICSID) throw new Error('Could not get UCF session — site may be down or changed');

  // Step 2: POST search
  const body = new URLSearchParams({
          ICAJAX:'0', ICType:'Panel', ICElementNum:'0', ICStateNum:ICState,
          ICAction:'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH',
          ICSaveWarningFilter:'0', ICChanged:'-1', ICResubmit:'0',
          ICSID, ICInstDtm:ICInst,
          'CLASS_SRCH_WRK2_STRM$35$': term,
          'CLASS_SRCH_WRK2_SUBJECT_SRCH$0': subject,
          'CLASS_SRCH_WRK2_CATALOG_NBR$1': number,
          'CLASS_SRCH_WRK2_SSR_OPEN_ONLY$chk': 'N',
  });

  const r2 = await fetch(BASE, {
          method: 'POST',
          headers: {
                    'User-Agent': UA,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Cookie': cookies,
                    'Referer': BASE,
                    'Origin': 'https://my.ucf.edu',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'same-origin',
          },
          body: body.toString(),
          redirect: 'follow',
  });

  if (!r2.ok) throw new Error(`UCF search returned HTTP ${r2.status}`);

  return parseResults(await r2.text(), subject, number);
}

function extractInput(html, name) {
      for (const re of [
              new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*?)["']`,'i'),
              new RegExp(`value=["']([^"']*?)["'][^>]*name=["']${name}["']`,'i'),
            ]) {
              const m = html.match(re); if (m) return m[1];
      }
      return null;
}

function parseCookies(hdr) {
      return hdr.split(/,(?=[^ ].*)/).map(c=>c.trim().split(';')[0].trim()).filter(c=>c.includes('=')).join('; ');
}

function parseResults(html, subject, number) {
      if (/no classes were found|no results found/i.test(html)) {
              return { found:false, overall:'Unknown', sections:[], message:'No classes found for this term' };
      }

  // Strategy 1: extract table rows
  const sections = [];
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rm;
      while ((rm = rowRe.exec(html)) !== null) {
              const cells = extractCells(rm[1]);
              if (cells.length >= 5) {
                        const classNum = (cells[0]||'').match(/\b(\d{5})\b/)?.[1];
                        if (!classNum) continue;
                        const statusCell = cells.find(c=>/open|closed|wait/i.test(c)) || '';
                        const status = /open/i.test(statusCell) ? 'Open' : /wait/i.test(statusCell) ? 'Waitlist' : 'Closed';
                        const dayCell = cells.find(c=>/Mo|Tu|We|Th|Fr|Sa|Su/i.test(c)) || '';
                        const timeCell = cells.find(c=>/\d{1,2}:\d{2}\s*(AM|PM)/i.test(c)) || '';
                        sections.push({ classNum, days: dayCell.trim(), time: timeCell.trim(), status, seats: '' });
              }
      }

  // Strategy 2: scan for status text
  if (sections.length === 0) {
          const sRe = /(?:>|\s)(Open|Closed|Wait\s+List)(?:<|[\s,])/gi;
          let m; const seen = new Set();
          while ((m = sRe.exec(html)) !== null) {
                    const status  = m[1].replace(/\s+/g,' ').trim();
                    const before  = html.substring(Math.max(0,m.index-400), m.index).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
                    const classNum = (before.match(/\b(\d{5})\b/)||[])[1]||'';
                    const timeStr  = (before.match(/\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)/i)||[])[0]||'';
                    const days     = (before.match(/\b(MoWeFr|MoWe|TuTh|Mo|Tu|We|Th|Fr|Sa|Su)+/i)||[])[0]||'';
                    const key = classNum||(status+timeStr);
                    if (!seen.has(key)) { seen.add(key); sections.push({classNum,days,time:timeStr,status,seats:''}); }
          }
  }

  const hasOpen = sections.some(s=>/open/i.test(s.status));
      const hasWait = sections.some(s=>/wait/i.test(s.status));
      const overall = hasOpen ? 'Open' : hasWait ? 'Waitlist' : sections.length ? 'Closed' : 'Unknown';

  return { found: sections.length > 0, overall, sections: sections.slice(0,30), subject, number };
}

function extractCells(rowHtml) {
      const cells=[], re=/<td[^>]*>([\s\S]*?)<\/td>/gi; let m;
      while((m=re.exec(rowHtml))!==null) cells.push(m[1].replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim());
      return cells;
}

// — JOB SEARCH ——————————————————————————————————————————————————————

function json(data, status=200) {
      return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function handleJobSearch(params, env) {
      const query = params.get('q') || '';
      const zip   = params.get('zip') || '';
      const page  = parseInt(params.get('page')||'1',10);
      if (!query) return json({ error: 'Provide ?q=keyword' }, 400);

  const cached = env.JOBS_KV ? await env.JOBS_KV.get(`jobs:${query}:${zip}:${page}`, 'json') : null;
      if (cached) return json({ ...cached, source: 'cache' });

  return json({ results: [], total: 0, page, source: 'live', message: 'No cached results yet' });
}

async function handleZipJobs(zip, env) {
      if (!zip) return json({ error: 'Provide a zip code' }, 400);
      const cached = env.JOBS_KV ? await env.JOBS_KV.get(`zip:${zip}`, 'json') : null;
      if (cached) return json({ ...cached, source: 'cache' });
      return json({ results: [], zip, source: 'live', message: 'No cached results yet' });
}

async function handleMeta(env) {
      return json({ status: 'ok', kv: !!env.JOBS_KV, timestamp: new Date().toISOString() });
}
