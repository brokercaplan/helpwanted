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

// ── UCF SEARCH ────────────────────────────────────────────────────────────────

async function handleUCFSearch(params) {
  const term    = params.get('term')    || '2268';
  const courses = (params.get('courses') || '').split(',').map(s=>s.trim()).filter(Boolean).slice(0,20);
  if (!courses.length) return json({ error: 'Provide ?courses=COP3330,MAC2311&term=2268' }, 400);

  const results = await Promise.all(courses.map(async code => {
    const p = parseCourseCode(code);
    if (!p) return { course: code.toUpperCase(), error: 'Unrecognized format', sections: [] };
    try {
      const data = await searchUCF(p.subject, p.number, term);
      return { course: code.toUpperCase(), ...data };
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

async function searchUCF(subject, number, term) {
  const BASE = 'https://my.ucf.edu/psp/IHPROD/GUEST/CSPROD/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL';
  const UA   = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  // Step 1: load page, get session tokens
  const r1 = await fetch(BASE, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
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
      'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies, 'Referer': BASE,
    },
    body: body.toString(),
    redirect: 'follow',
  });
  if (!r2.ok) throw new Error(`UCF search returned HTTP ${r2.status}`);

  return parseResults(await r2.text(), subject, number);
}

function extractInput(html, name) {
  for (const re of [
    new RegExp(`name=["']${name}["'][^>]*?value=["']([^"']*?)["']`,'i'),
    new RegExp(`value=["']([^"']*?)["'][^>]*?name=["']${name}["']`,'i'),
  ]) {
    const m = html.match(re); if (m) return m[1];
  }
  return null;
}

function parseCookies(hdr) {
  return hdr.split(/,(?=[^ ].*?=)/).map(c=>c.trim().split(';')[0].trim()).filter(c=>c.includes('=')).join('; ');
}

function parseResults(html, subject, number) {
  if (/no classes were found|no results found/i.test(html)) {
    return { found:false, overall:'Unknown', sections:[], message:'No classes found for this term' };
  }

  const sections = [];

  // Strategy 1: PeopleSoft grid rows
  const rowRe = /<tr[^>]*class=["'][^"']*(?:PSGRID|PSLEVEL)[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html)) !== null) {
    const cells = extractCells(row[1]);
    if (cells.length >= 3) {
      const s = buildSection(cells);
      if (s) sections.push(s);
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
      const timeStr  = (before.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)?/i)||[])[0]||'';
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

function buildSection(cells) {
  let classNum='',section='',days='',time='',instructor='',status='',seats='';
  for (const c of cells) {
    if (/^\d{5}$/.test(c))                       classNum=c;
    else if (/^[A-Z]\d{3}$/i.test(c))            section=c;
    else if (/\d{1,2}:\d{2}/i.test(c))           time=c;
    else if (/\b(Mo|Tu|We|Th|Fr|Sa|Su)/i.test(c) && c.length<20) days=c;
    else if (/^(Open|Closed|Wait\s+List)$/i.test(c)) status=c;
    else if (/\d+ of \d+/i.test(c))              seats=c;
    else if (c.length>3&&c.length<40&&/[A-Z]/.test(c)&&!instructor) instructor=c;
  }
  if (!status&&!classNum) return null;
  return {classNum,section,days,time,instructor,status:status||'Unknown',seats};
}

// ── JOBS ──────────────────────────────────────────────────────────────────────

function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function handleJobSearch(params, env) {
  const zip=params.get('zip'), lat=parseFloat(params.get('lat')), lng=parseFloat(params.get('lng'));
  const jobType=params.get('type')||'', query=(params.get('q')||'').toLowerCase().trim();
  const limit=Math.min(parseInt(params.get('limit')||'100'),200);
  let jobs=[];
  if (zip&&zip.length===5) { const d=await env.JOBS_KV.get('jobs:zip:'+zip,'json'); if(d&&d.length) jobs=d; }
  if (!jobs.length) jobs=await loadAllJobs(env);
  let uLat=(!isNaN(lat)&&lat)?lat:null, uLng=(!isNaN(lng)&&lng)?lng:null;
  if (zip&&zip.length===5&&!uLat) { const z=ZIP_COORDS[zip]; if(z){uLat=z[0];uLng=z[1];} }
  if (uLat&&uLng) jobs=jobs.map(j=>({...j,distanceMiles:(j.lat&&j.lng)?haversine(uLat,uLng,j.lat,j.lng):null}));
  if (jobType) jobs=jobs.filter(j=>(j.jobType||'').toLowerCase().includes(jobType.toLowerCase()));
  if (query) jobs=jobs.filter(j=>((j.title||'')+(j.company||'')+(j.description||'')).toLowerCase().includes(query));
  jobs.sort((a,b)=>((a.distanceMiles??9999)-(b.distanceMiles??9999)));
  const seen=new Set();
  const unique=jobs.filter(j=>{const k=j.id||(j.title+j.company);if(seen.has(k))return false;seen.add(k);return true;});
  return json({count:unique.length,jobs:unique.slice(0,limit),zip});
}
async function loadAllJobs(env){const meta=await env.JOBS_KV.get('jobs:meta','json');const t=meta?.totalChunks||3;const a=[];for(let i=0;i<t;i++){const c=await env.JOBS_KV.get('jobs:all:'+i,'json');if(c&&Array.isArray(c))a.push(...c);}return a;}
async function handleZipJobs(zip,env){let j=await env.JOBS_KV.get('jobs:zip:'+zip,'json');if(!j||!j.length)j=await loadAllJobs(env);return json({count:j.length,jobs:j,zip});}
async function handleMeta(env){const m=await env.JOBS_KV.get('jobs:meta','json');return json(m||{lastUpdated:null,totalJobs:0});}
function haversine(a,b,c,d){const R=3959,dA=toRad(c-a),dB=toRad(d-b),x=Math.sin(dA/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dB/2)**2;return Math.round(R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))*10)/10;}
function toRad(d){return d*(Math.PI/180);}
const ZIP_COORDS={'10001':[40.7484,-74.0014],'90001':[33.9731,-118.2479],'60601':[41.8827,-87.6233],'77001':[29.7543,-95.3677],'32801':[28.5383,-81.3792],'33601':[27.9506,-82.4572],'32816':[28.6024,-81.2001],'94102':[37.7749,-122.4194],'98101':[47.6062,-122.3321],'80201':[39.7392,-104.9903],'02101':[42.3601,-71.0589],'30301':[33.7490,-84.3880]};
