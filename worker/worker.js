/**
 * Help Wanted - Cloudflare Worker
 * 
 * This is the backend API that the frontend PWA calls.
 * All data is served from KV (pre-loaded by the daily ingestion script).
 * Zero live API calls happen here — everything is pre-cached.
 * 
 * Deploy to: Cloudflare Workers (free tier: 100,000 req/day)
 * KV binding: JOBS_KV (bind in Cloudflare Workers dashboard)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers for your frontend domain
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route: GET /api/jobs?zip=33139&radius=5&type=Full-time&q=server
      if (url.pathname === '/api/jobs') {
        return await handleJobSearch(url.searchParams, env, corsHeaders);
      }

      // Route: GET /api/jobs/zip/{zipcode} - jobs for a specific zip
      if (url.pathname.startsWith('/api/jobs/zip/')) {
        const zip = url.pathname.replace('/api/jobs/zip/', '').trim();
        return await handleZipJobs(zip, env, corsHeaders);
      }

      // Route: GET /api/meta - database stats
      if (url.pathname === '/api/meta') {
        return await handleMeta(env, corsHeaders);
      }

      // Route: GET /api/health - health check
      if (url.pathname === '/api/health') {
        return new Response(
          JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
          { headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { status: 404, headers: corsHeaders }
      );

    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Internal error', message: err.message }),
        { status: 500, headers: corsHeaders }
      );
    }
  }
};

/**
 * Search jobs by location (zip or lat/lng) with optional filters
 */
async function handleJobSearch(params, env, corsHeaders) {
  const zip = params.get('zip');
  const lat = parseFloat(params.get('lat'));
  const lng = parseFloat(params.get('lng'));
  const radiusMiles = parseFloat(params.get('radius') || '10');
  const jobType = params.get('type') || '';
  const query = (params.get('q') || '').toLowerCase().trim();
  const limit = Math.min(parseInt(params.get('limit') || '50'), 200);

  let jobs = [];

  if (zip && zip.length === 5) {
    // Fast path: lookup by zip code directly
    const zipData = await env.JOBS_KV.get(`jobs:zip:${zip}`, 'json');
    if (zipData) jobs = zipData;

    // Also grab neighboring zips if radius > 5 miles
    if (radiusMiles > 5) {
      const neighborZips = await getNeighboringZips(zip, radiusMiles, env);
      for (const nZip of neighborZips) {
        const nData = await env.JOBS_KV.get(`jobs:zip:${nZip}`, 'json');
        if (nData) jobs = jobs.concat(nData);
      }
    }
  } else if (lat && lng) {
    // Coordinate-based search: find zips near these coords
    const nearbyZips = await findZipsNearCoords(lat, lng, radiusMiles, env);
    for (const nZip of nearbyZips) {
      const nData = await env.JOBS_KV.get(`jobs:zip:${nZip}`, 'json');
      if (nData) jobs = jobs.concat(nData);
    }
  }

  // Apply filters
  if (jobType) {
    jobs = jobs.filter(j => j.jobType === jobType || j.jobType?.includes(jobType));
  }

  if (query) {
    jobs = jobs.filter(j => {
      const searchText = `${j.title} ${j.company} ${j.description}`.toLowerCase();
      return searchText.includes(query);
    });
  }

  // Add distance from user if coords provided
  if (lat && lng) {
    jobs = jobs.map(j => ({
      ...j,
      distanceMiles: j.lat && j.lng ? calculateDistance(lat, lng, j.lat, j.lng) : null
    }));
    jobs.sort((a, b) => (a.distanceMiles || 999) - (b.distanceMiles || 999));
  }

  // Remove duplicates
  const seen = new Set();
  const unique = jobs.filter(j => {
    if (seen.has(j.id)) return false;
    seen.add(j.id);
    return true;
  });

  return new Response(
    JSON.stringify({
      count: unique.length,
      jobs: unique.slice(0, limit),
      searchedZip: zip || null
    }),
    { headers: corsHeaders }
  );
}

/**
 * Get all jobs for a specific zip code
 */
async function handleZipJobs(zip, env, corsHeaders) {
  const jobs = await env.JOBS_KV.get(`jobs:zip:${zip}`, 'json');
  if (!jobs) {
    return new Response(
      JSON.stringify({ count: 0, jobs: [], zip }),
      { headers: corsHeaders }
    );
  }
  return new Response(
    JSON.stringify({ count: jobs.length, jobs, zip }),
    { headers: corsHeaders }
  );
}

/**
 * Return database metadata/stats
 */
async function handleMeta(env, corsHeaders) {
  const meta = await env.JOBS_KV.get('jobs:meta', 'json');
  return new Response(
    JSON.stringify(meta || { lastUpdated: null, totalJobs: 0, totalZips: 0 }),
    { headers: corsHeaders }
  );
}

/**
 * Get nearby zip codes from a center zip within radius
 * Simplified version - uses KV lookup
 */
async function getNeighboringZips(centerZip, radiusMiles, env) {
  // In a full implementation, you'd have a zip-to-coordinates lookup
  // For now, return an empty array - the direct zip lookup handles most cases
  return [];
}

/**
 * Find zip codes near given coordinates
 */
async function findZipsNearCoords(lat, lng, radiusMiles, env) {
  // Simplified: convert coords to zip and search nearby
  // A full implementation would use a spatial index in KV
  return [];
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c * 10) / 10;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}
