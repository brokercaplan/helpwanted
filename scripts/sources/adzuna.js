/**
 * Adzuna API Fetcher
 * Free tier: 250 requests/day
 * Register at: developer.adzuna.com
 * 
 * IMPORTANT: This is called ONCE per day (not per user search).
 * We do a broad search to get a wide variety of jobs in bulk.
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://api.adzuna.com/v1/api/jobs/us/search';

// Top US metro areas to sweep in one daily batch
// We cycle through these using our single daily call budget
const METRO_SEARCHES = [
  'New York',
  'Los Angeles',
  'Chicago',
  'Houston',
  'Phoenix',
  'Philadelphia',
  'San Antonio',
  'San Diego',
  'Dallas',
  'Miami',
  'Atlanta',
  'Seattle',
  'Boston',
  'Denver',
  'Las Vegas',
  'Portland',
  'Nashville',
  'Austin',
  'Orlando',
  'Tampa'
];

export async function fetchAdzunaJobs() {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  
  if (!appId || !appKey) {
    console.log('    Adzuna: Missing credentials');
    return [];
  }

  const allJobs = [];
  
  // Use our daily budget wisely: fetch 50 results per location
  // 20 locations x 1 request each = 20 requests total (within 250/day limit)
  // Each returns up to 50 jobs = up to 1000 jobs per day from Adzuna
  for (const location of METRO_SEARCHES) {
    try {
      const jobs = await fetchLocationJobs(appId, appKey, location);
      allJobs.push(...jobs);
      await sleep(500); // Be polite to the API
    } catch (err) {
      console.error(`    Adzuna ${location} error: ${err.message}`);
    }
  }

  return allJobs;
}

async function fetchLocationJobs(appId, appKey, location) {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: 50,
    what: '',
    where: location,
    content_type: 'application/json'
  });

  const res = await fetch(`${BASE_URL}/1?${params}`, { timeout: 15000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
  const data = await res.json();
  return (data.results || []).map(job => normalizeAdzunaJob(job));
}

function normalizeAdzunaJob(job) {
  const locationStr = [job.location?.display_name, job.location?.area?.[2]].filter(Boolean).join(', ');
  const { city, state, zip } = parseLocation(locationStr);

  return {
    id: `az_${job.id}`,
    source: 'adzuna',
    title: job.title || '',
    company: job.company?.display_name || '',
    description: job.description || '',
    locationRaw: locationStr,
    city: city || job.location?.area?.[3] || '',
    state: state || job.location?.area?.[2] || '',
    zip,
    lat: job.latitude || null,
    lng: job.longitude || null,
    jobType: job.contract_time === 'part_time' ? 'Part-time' : 'Full-time',
    salaryMin: job.salary_min || null,
    salaryMax: job.salary_max || null,
    salaryText: job.salary_min ? `$${Math.round(job.salary_min).toLocaleString()} - $${Math.round(job.salary_max || job.salary_min).toLocaleString()}` : '',
    applyUrl: job.redirect_url || job.adref,
    postedAt: job.created || new Date().toISOString(),
    externalId: job.id
  };
}

function parseLocation(locationStr) {
  if (!locationStr) return { city: '', state: '', zip: '' };
  const zipMatch = locationStr.match(/\b(\d{5})\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  const parts = locationStr.split(',').map(s => s.trim());
  return { city: parts[0] || '', state: parts[1] || '', zip };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
