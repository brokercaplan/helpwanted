/**
 * Adzuna API Fetcher
 * Free tier: 250 requests/day
 * Docs: https://developer.adzuna.com/docs/search
 *
 * IMPORTANT: Called ONCE per day from GitHub Actions.
 * We search multiple US cities to build a broad job database.
 */
import fetch from 'node-fetch';

const BASE_URL = 'https://api.adzuna.com/v1/api/jobs/us/search/1';

const SEARCHES = [
  { what: 'retail', where: 'New York' },
  { what: 'retail', where: 'Los Angeles' },
  { what: 'retail', where: 'Chicago' },
  { what: 'retail', where: 'Houston' },
  { what: 'retail', where: 'Phoenix' },
  { what: 'warehouse', where: 'Dallas' },
  { what: 'warehouse', where: 'Atlanta' },
  { what: 'warehouse', where: 'Seattle' },
  { what: 'cashier', where: 'Miami' },
  { what: 'cashier', where: 'Denver' },
  { what: 'driver', where: 'Philadelphia' },
  { what: 'driver', where: 'San Antonio' },
  { what: 'customer service', where: 'Boston' },
  { what: 'customer service', where: 'Las Vegas' },
  { what: 'food service', where: 'Nashville' },
  { what: 'food service', where: 'Austin' },
  { what: 'stocking', where: 'Orlando' },
  { what: 'associate', where: 'Tampa' },
  { what: 'part time', where: 'Portland' },
  { what: 'entry level', where: 'San Diego' },
  ];

export async function fetchAdzunaJobs() {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
        console.log('  Adzuna: Missing credentials, skipping.');
        return [];
  }

  const allJobs = [];

  for (const search of SEARCHES) {
        try {
                const jobs = await fetchSearch(appId, appKey, search.what, search.where);
                allJobs.push(...jobs);
                await sleep(600);
        } catch (err) {
                console.error(`  Adzuna [${search.what} in ${search.where}] error: ${err.message}`);
        }
  }

  console.log(`  Adzuna: ${allJobs.length} jobs fetched`);
    return allJobs;
}

async function fetchSearch(appId, appKey, what, where) {
    const url = new URL(BASE_URL);
    url.searchParams.set('app_id', appId);
    url.searchParams.set('app_key', appKey);
    url.searchParams.set('results_per_page', '50');
    url.searchParams.set('what', what);
    url.searchParams.set('where', where);
    url.searchParams.set('country', 'us');
    url.searchParams.set('sort_by', 'date');

  const res = await fetch(url.toString(), {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
  });

  if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.substring(0, 200)}`);
  }

  const data = await res.json();
    return (data.results || []).map(job => normalizeJob(job));
}

function normalizeJob(job) {
    const locationStr = job.location?.display_name || '';
    const parts = locationStr.split(',').map(s => s.trim());
    const city = parts[0] || '';
    const state = parts[1] || job.location?.area?.[2] || '';
    const zipMatch = locationStr.match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : '';

  return {
        id: `az_${job.id}`,
        source: 'adzuna',
        title: (job.title || '').trim(),
        company: job.company?.display_name || '',
        description: (job.description || '').substring(0, 1000),
        locationRaw: locationStr,
        city,
        state,
        zip,
        lat: job.latitude || null,
        lng: job.longitude || null,
        jobType: job.contract_time === 'part_time' ? 'Part-time' : 'Full-time',
        salaryMin: job.salary_min || null,
        salaryMax: job.salary_max || null,
        salaryText: job.salary_min
          ? `$${Math.round(job.salary_min).toLocaleString()} - $${Math.round(job.salary_max || job.salary_min).toLocaleString()}`
                : '',
        applyUrl: job.redirect_url || job.adref || '',
        postedAt: job.created || new Date().toISOString(),
        externalId: job.id,
  };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
