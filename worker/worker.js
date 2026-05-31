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

// Uses UCF's public ScottySearch API — no session scraping needed
async function searchUCF(subject, number, term) {
    const course = `${subject}${number}`;
    // UCF public section search API
  const apiUrl = `https://search.cm.ucf.edu/api/?catalog=false&query=${encodeURIComponent(subject+' '+number)}&term=${term}`;

  const r = await fetch(apiUrl, {
        headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; UCFClassTracker/1.0)',
                'Accept': 'application/json',
        }
  });

  if (!r.ok) throw new Error(`UCF search API returned HTTP ${r.status}`);

  const data = await r.json();

  // data is an array of course objects, each with sections
  const sections = [];
    let found = false;

  for (const courseObj of (data || [])) {
        // Match subject+number
      const cCode = (courseObj.code || '').replace(/\s+/g,'').toUpperCase();
        const qCode = course.toUpperCase();
        if (!cCode.startsWith(qCode) && !qCode.startsWith(cCode.substring(0,qCode.length))) continue;

      found = true;
        for (const sec of (courseObj.sections || [])) {
                const meetTimes = (sec.meetings || []).map(m => {
                          const days = m.days || '';
                          const start = m.start_time || '';
                          const end = m.end_time || '';
                          return { days, time: start && end ? `${start}-${end}` : (start || '') };
                });
                const meeting = meetTimes[0] || { days: '', time: '' };

          let status = 'Unknown';
                const enrolled = sec.seats || 0;
                const capacity = sec.max_seats || 0;
                const waitlist = sec.waitlist || 0;
                if (capacity > 0) {
                          if (enrolled < capacity) status = 'Open';
                          else if (waitlist > 0) status = 'Waitlist';
                          else status = 'Closed';
                }

          sections.push({
                    classNum: String(sec.number || sec.crn || ''),
                    days: meeting.days,
                    time: meeting.time,
                    status,
                    seats: capacity > 0 ? `${enrolled}/${capacity}` : '',
          });
        }
  }

  const hasOpen = sections.some(s=>/open/i.test(s.status));
    const hasWait = sections.some(s=>/wait/i.test(s.status));
    const overall = hasOpen ? 'Open' : hasWait ? 'Waitlist' : sections.length ? 'Closed' : 'Unknown';

  return { found, overall, sections: sections.slice(0,30), subject, number };
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
