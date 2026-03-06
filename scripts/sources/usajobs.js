/**
 * USAJobs API Fetcher
 * Free API - requires registration at developer.usajobs.gov
 * 10,000 requests/day - we use just ONE broad daily fetch
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://data.usajobs.gov/api/search';

export async function fetchUSAJobs() {
  const apiKey = process.env.USAJOBS_API_KEY;
  const email = process.env.USAJOBS_EMAIL;
  
  if (!apiKey || !email) {
    console.log('    USAJobs: Missing credentials');
    return [];
  }

  const allJobs = [];
  // Fetch top 500 most recent US jobs in one call
  const params = new URLSearchParams({
    ResultsPerPage: 500,
    SortField: 'OpenDate',
    SortDirection: 'Desc',
    WhoMayApply: 'public'
  });

  try {
    const res = await fetch(`${BASE_URL}?${params}`, {
      headers: {
        'Authorization-Key': apiKey,
        'User-Agent': email,
        'Host': 'data.usajobs.gov'
      },
      timeout: 30000
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.SearchResult?.SearchResultItems || [];

    for (const item of items) {
      const job = item.MatchedObjectDescriptor;
      if (!job) continue;
      allJobs.push(normalizeUSAJob(job));
    }
  } catch (err) {
    console.error(`    USAJobs error: ${err.message}`);
  }

  return allJobs;
}

function normalizeUSAJob(job) {
  const locationStr = job.PositionLocation?.[0]?.LocationName || '';
  const { city, state, zip } = parseLocation(locationStr);
  const salaryMin = parseFloat(job.PositionRemuneration?.[0]?.MinimumRange || 0);
  const salaryMax = parseFloat(job.PositionRemuneration?.[0]?.MaximumRange || 0);
  const salaryInterval = job.PositionRemuneration?.[0]?.RateIntervalCode || '';

  return {
    id: `usa_${job.PositionID}`,
    source: 'usajobs',
    title: job.PositionTitle || '',
    company: job.OrganizationName || 'US Government',
    description: job.QualificationSummary || '',
    locationRaw: locationStr,
    city,
    state,
    zip,
    lat: job.PositionLocation?.[0]?.Latitude || null,
    lng: job.PositionLocation?.[0]?.Longitude || null,
    jobType: job.PositionSchedule?.[0]?.Name || 'Full-time',
    salaryMin: salaryMin || null,
    salaryMax: salaryMax || null,
    salaryText: salaryMin ? `$${salaryMin.toLocaleString()}${salaryInterval === 'PA' ? '/yr' : '/hr'}` : '',
    applyUrl: job.ApplyURI?.[0] || job.PositionURI,
    postedAt: job.PublicationStartDate || new Date().toISOString(),
    externalId: job.PositionID
  };
}

function parseLocation(locationStr) {
  if (!locationStr) return { city: '', state: '', zip: '' };
  const zipMatch = locationStr.match(/\b(\d{5})\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  const parts = locationStr.split(',').map(s => s.trim());
  return { city: parts[0] || '', state: parts[1] || '', zip };
}
