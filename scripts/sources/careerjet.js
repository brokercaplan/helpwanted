/**
 * The Muse API Fetcher (replaces CareerJet)
 * Free public API - no key required for basic access
 * Returns 1000s of real jobs from top companies
 * Docs: https://www.themuse.com/developers/api/v2
 */
import fetch from 'node-fetch';

const BASE_URL = 'https://www.themuse.com/api/public/jobs';

// Fetch multiple pages to maximize job count
const PAGES_TO_FETCH = 10; // 20 jobs per page = 200 jobs

export async function fetchCareerjetJobs() {
      const allJobs = [];

  console.log('  Fetching The Muse jobs...');

  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
          try {
                    const jobs = await fetchPage(page);
                    if (jobs.length === 0) break;
                    allJobs.push(...jobs);
                    await sleep(400);
          } catch (err) {
                    console.error(`  TheMuse page ${page} error: ${err.message}`);
                    break;
          }
  }

  console.log(`  The Muse: ${allJobs.length} jobs fetched`);
      return allJobs;
}

async function fetchPage(page) {
      const url = new URL(BASE_URL);
      url.searchParams.set('page', page);
      url.searchParams.set('api_key', ''); // public access, no key needed

  const res = await fetch(url.toString(), {
          headers: {
                    'User-Agent': 'HelpWanted-JobAggregator/1.0',
                    'Accept': 'application/json',
          },
          timeout: 15000,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
      return (data.results || []).map(job => normalizeJob(job));
}

function normalizeJob(job) {
      const loc = job.locations?.[0]?.name || '';
      const parts = loc.split(',').map(s => s.trim());
      const city = parts[0] || '';
      const state = parts[1] || '';

  // Extract salary if present in levels
  const level = job.levels?.[0]?.name || '';

  return {
          id: `muse_${job.id}`,
          source: 'themuse',
          title: (job.name || '').trim(),
          company: job.company?.name || '',
          description: (job.contents || '').replace(/<[^>]*>/g, '').substring(0, 1000),
          locationRaw: loc,
          city,
          state,
          zip: '',
          lat: null,
          lng: null,
          jobType: detectJobType(job.name, level),
          salaryMin: null,
          salaryMax: null,
          salaryText: '',
          applyUrl: job.refs?.landing_page || '',
          postedAt: job.publication_date || new Date().toISOString(),
          externalId: String(job.id),
  };
}

function detectJobType(title, level) {
      const text = ((title || '') + ' ' + (level || '')).toLowerCase();
      if (text.includes('part-time') || text.includes('part time')) return 'Part-time';
      if (text.includes('contract') || text.includes('freelance')) return 'Contract';
      if (text.includes('intern')) return 'Internship';
      return 'Full-time';
}

function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
}
