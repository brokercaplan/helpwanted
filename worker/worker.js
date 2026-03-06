/**
 * Help Wanted - Cloudflare Worker
 *
 * Backend API served from pre-cached Cloudflare KV.
 * Zero live API calls - everything is pre-built by the daily ingestion script.
 */
export default {
    async fetch(request, env, ctx) {
          const url = new URL(request.url);

      const corsHeaders = {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
              'Content-Type': 'application/json'
      };

      if (request.method === 'OPTIONS') {
              return new Response(null, { headers: corsHeaders });
      }

      try {
              if (url.pathname === '/api/jobs') {
                        return await handleJobSearch(url.searchParams, env, corsHeaders);
              }
              if (url.pathname.startsWith('/api/jobs/zip/')) {
                        const zip = url.pathname.replace('/api/jobs/zip/', '').trim();
                        return await handleZipJobs(zip, env, corsHeaders);
              }
              if (url.pathname === '/api/meta') {
                        return await handleMeta(env, corsHeaders);
              }
              if (url.pathname === '/api/health') {
                        return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), { headers: corsHeaders });
              }
              return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
      } catch (err) {
              return new Response(JSON.stringify({ error: 'Internal error', message: err.message }), { status: 500, headers: corsHeaders });
      }
    }
};

/**
 * Search jobs - tries zip lookup first, falls back to all-jobs chunks.
 */
async function handleJobSearch(params, env, corsHeaders) {
    const zip = params.get('zip');
    const lat = parseFloat(params.get('lat'));
    const lng = parseFloat(params.get('lng'));
    const radiusMiles = parseFloat(params.get('radius') || '25');
    const jobType = params.get('type') || '';
    const query = (params.get('q') || '').toLowerCase().trim();
    const limit = Math.min(parseInt(params.get('limit') || '100'), 200);

  let jobs = [];
    let searchedZip = null;

  // 1. Try zip-specific lookup first (fast path)
  if (zip && zip.length === 5) {
        searchedZip = zip;
        const zipData = await env.JOBS_KV.get('jobs:zip:' + zip, 'json');
        if (zipData && zipData.length > 0) {
                jobs = zipData;
        }
  }

  // 2. Always load all jobs (covers remote jobs and zip mismatches)
  if (jobs.length === 0) {
        jobs = await loadAllJobs(env);
  }

  // 3. Determine user coordinates
  let userLat = (!isNaN(lat) && lat !== 0) ? lat : null;
    let userLng = (!isNaN(lng) && lng !== 0) ? lng : null;

  // Look up zip coords if we have zip but no lat/lng
  if (zip && zip.length === 5 && !userLat) {
        const zc = ZIP_COORDS[zip];
        if (zc) { userLat = zc[0]; userLng = zc[1]; }
  }

  // 4. Add distance to each job
  if (userLat && userLng) {
        jobs = jobs.map(j => ({
                ...j,
                distanceMiles: (j.lat && j.lng) ? calculateDistance(userLat, userLng, j.lat, j.lng) : null
        }));
  }

  // 5. Apply type filter
  if (jobType) {
        jobs = jobs.filter(j => (j.jobType || '').toLowerCase().includes(jobType.toLowerCase()));
  }

  // 6. Apply text search
  if (query) {
        jobs = jobs.filter(j => {
                const text = ((j.title || '') + ' ' + (j.company || '') + ' ' + (j.description || '')).toLowerCase();
                return text.includes(query);
        });
  }

  // 7. Sort: jobs with location by distance, remote jobs at end
  jobs.sort((a, b) => {
        const aDist = (a.distanceMiles !== null && a.distanceMiles !== undefined) ? a.distanceMiles : 9999;
        const bDist = (b.distanceMiles !== null && b.distanceMiles !== undefined) ? b.distanceMiles : 9999;
        return aDist - bDist;
  });

  // 8. Deduplicate
  const seen = new Set();
    const unique = jobs.filter(j => {
          const key = j.id || (j.title + j.company);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
    });

  return new Response(
        JSON.stringify({ count: unique.length, jobs: unique.slice(0, limit), zip: searchedZip }),
    { headers: corsHeaders }
      );
}

/**
 * Load all jobs from chunked KV keys (jobs:all:0, jobs:all:1, etc.)
 */
async function loadAllJobs(env) {
    const meta = await env.JOBS_KV.get('jobs:meta', 'json');
    const totalChunks = meta?.totalChunks || 3;
    const all = [];
    for (let i = 0; i < totalChunks; i++) {
          const chunk = await env.JOBS_KV.get('jobs:all:' + i, 'json');
          if (chunk && Array.isArray(chunk)) {
                  all.push(...chunk);
          }
    }
    return all;
}

/**
 * Get jobs for a specific zip, fallback to all jobs
 */
async function handleZipJobs(zip, env, corsHeaders) {
    let jobs = await env.JOBS_KV.get('jobs:zip:' + zip, 'json');
    if (!jobs || jobs.length === 0) {
          jobs = await loadAllJobs(env);
    }
    return new Response(JSON.stringify({ count: jobs.length, jobs, zip }), { headers: corsHeaders });
}

/**
 * Return database metadata
 */
async function handleMeta(env, corsHeaders) {
    const meta = await env.JOBS_KV.get('jobs:meta', 'json');
    return new Response(
          JSON.stringify(meta || { lastUpdated: null, totalJobs: 0, totalZips: 0 }),
      { headers: corsHeaders }
        );
}

function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 3959;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 10) / 10;
}

function toRad(deg) { return deg * (Math.PI / 180); }

// Common zip code coordinates for fast lookup
const ZIP_COORDS = {
    '10001':[40.7484,-74.0014],'10002':[40.7157,-73.9863],'11201':[40.6928,-73.9903],
    '11354':[40.7687,-73.8330],'10451':[40.8200,-73.9203],'90001':[33.9731,-118.2479],
    '90210':[34.0901,-118.4065],'60601':[41.8827,-87.6233],'77001':[29.7543,-95.3677],
    '85001':[33.4484,-112.0740],'19101':[39.9526,-75.1652],'78201':[29.4241,-98.4936],
    '92101':[32.7157,-117.1611],'75201':[32.7767,-96.7970],'95101':[37.3382,-121.8863],
    '94102':[37.7749,-122.4194],'78701':[30.2672,-97.7431],'98101':[47.6062,-122.3321],
    '80201':[39.7392,-104.9903],'02101':[42.3601,-71.0589],'30301':[33.7490,-84.3880],
    '89101':[36.1699,-115.1398],'37201':[36.1627,-86.7816],'32801':[28.5383,-81.3792],
    '33601':[27.9506,-82.4572],'97201':[45.5051,-122.6750],'28201':[35.2271,-80.8431],
    '55401':[44.9778,-93.2650],'48201':[42.3314,-83.0458],
    '33101':[25.7617,-80.1918],'33125':[25.7739,-80.2231],'33126':[25.7642,-80.2864],
    '33127':[25.8050,-80.2003],'33128':[25.7742,-80.1977],'33129':[25.7500,-80.1946],
    '33130':[25.7651,-80.1993],'33131':[25.7580,-80.1884],'33132':[25.7755,-80.1839],
    '33133':[25.7261,-80.2411],'33134':[25.7444,-80.2719],'33135':[25.7681,-80.2396],
    '33136':[25.7884,-80.2045],'33137':[25.8192,-80.1837],'33138':[25.8533,-80.1827],
    '33139':[25.7907,-80.1300],'33140':[25.8141,-80.1288],'33141':[25.8490,-80.1284],
    '33142':[25.8052,-80.2396],'33143':[25.7050,-80.2811],'33144':[25.7607,-80.3233],
    '33145':[25.7511,-80.2232],'33146':[25.7212,-80.2719],'33147':[25.8292,-80.2396],
    '33150':[25.8674,-80.2149],'33155':[25.7462,-80.3233],'33157':[25.6418,-80.3497],
    '33160':[25.9618,-80.1452],'33161':[25.9000,-80.1827],'33162':[25.9392,-80.1827],
    '33166':[25.8284,-80.2958],'33167':[25.8718,-80.2396],'33168':[25.8861,-80.2149],
    '33169':[25.9163,-80.2149],'33172':[25.7786,-80.3865],'33174':[25.7608,-80.3653],
    '33175':[25.7416,-80.3653],'33176':[25.6879,-80.3497],'33177':[25.6494,-80.3941],
    '33178':[25.8204,-80.3497],'33179':[25.9525,-80.1827],'33180':[25.9659,-80.1452],
    '33181':[25.9209,-80.1452],'33182':[25.7786,-80.4327],'33183':[25.7286,-80.4327],
    '33184':[25.7573,-80.3958],'33185':[25.7416,-80.4497],'33186':[25.6879,-80.4130],
    '33193':[25.7016,-80.4497],'33196':[25.7016,-80.4802],
    '33301':[26.1220,-80.1434],'33304':[26.1276,-80.1234],'33305':[26.1503,-80.1234],
    '33306':[26.1718,-80.1234],'33308':[26.1939,-80.1234],'33309':[26.1718,-80.1674],
    '33311':[26.1276,-80.1674],'33312':[26.0820,-80.1674],'33313':[26.1069,-80.1974],
    '33314':[26.0579,-80.1994],'33315':[26.0820,-80.1434],'33316':[26.1030,-80.1234],
    '33317':[26.1069,-80.2244],'33319':[26.1718,-80.1994],'33321':[26.2044,-80.2524],
    '33322':[26.1939,-80.2524],'33323':[26.1718,-80.2804],'33324':[26.1503,-80.2524],
    '33325':[26.1276,-80.2804],'33326':[26.1069,-80.2804],'33327':[26.0820,-80.2804],
    '33334':[26.1939,-80.1454],'33351':[26.1939,-80.2244],
    '33401':[26.7153,-80.0534],'33405':[26.6757,-80.0534],'33407':[26.7584,-80.0534],
    '33409':[26.7153,-80.0924],'33410':[26.7584,-80.1394],'33411':[26.7153,-80.1674],
    '33412':[26.7584,-80.2244],'33413':[26.7153,-80.2244],'33414':[26.6931,-80.2244],
    '33415':[26.7153,-80.1394],'33417':[26.7584,-80.0924],'33418':[26.7920,-80.1394],
    '33426':[26.5765,-80.0794],'33428':[26.3536,-80.1234],'33431':[26.3659,-80.0714],
    '33432':[26.3536,-80.0714],'33433':[26.3536,-80.1234],'33434':[26.3949,-80.1234],
    '33436':[26.3536,-80.0924],'33437':[26.3949,-80.0924],'33441':[26.3097,-80.0924],
    '33442':[26.3097,-80.1394],'33444':[26.4565,-80.0714],'33445':[26.4565,-80.0924],
    '33446':[26.4565,-80.1234],'33460':[26.6148,-80.0534],'33461':[26.5765,-80.0924],
    '33462':[26.5765,-80.0534],'33463':[26.5765,-80.1234],'33467':[26.5765,-80.1674],
    '33469':[26.8309,-80.0534],'33470':[26.7920,-80.2244],'33472':[26.3949,-80.1674],
    '33473':[26.3536,-80.1674],'33477':[26.8507,-80.0714],'33478':[26.8920,-80.1794],
    '33480':[26.6931,-80.0354],'33483':[26.4565,-80.0534],'33484':[26.3949,-80.1234]
};
