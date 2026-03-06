/**
 * Jobicy Job Fetcher (replaces iCIMS scraper)
 * Free public API - no key required
 * Focus on US-based jobs across various industries
 * Docs: https://jobicy.com/jobs-rss-feed
 */
import fetch from 'node-fetch';

// Jobicy offers a free JSON API endpoint
const BASE_URL = 'https://jobicy.com/api/v2/remote-jobs';

// Job categories to search
const CATEGORIES = [
    'retail',
    'customer-service',
    'food-service',
    'healthcare',
    'logistics',
    'administrative',
    'sales',
    'education',
  ];

export async function fetchIcimsJobs() {
    const allJobs = [];

  console.log('  Fetching Jobicy jobs...');

  // Fetch general jobs first (no category filter)
  try {
        const jobs = await fetchJobs({ count: 50 });
        allJobs.push(...jobs);
        await sleep(500);
  } catch (err) {
        console.error(`  Jobicy general fetch error: ${err.message}`);
  }

  // Fetch by category
  for (const tag of CATEGORIES) {
        try {
                const jobs = await fetchJobs({ count: 20, tag });
                allJobs.push(...jobs);
                await sleep(400);
        } catch (err) {
                // skip on error, move to next
        }
  }

  // Deduplicate
  const seen = new Set();
    const unique = allJobs.filter(j => {
          if (seen.has(j.externalId)) return false;
          seen.add(j.externalId);
          return true;
    });

  console.log(`  Jobicy: ${unique.length} jobs fetched`);
    return unique;
}

async function fetchJobs({ count = 20, tag = '' } = {}) {
    const url = new URL(BASE_URL);
    url.searchParams.set('count', count);
    if (tag) url.searchParams.set('tag', tag);

  const res = await fetch(url.toString(), {
        headers: {
                'User-Agent': 'HelpWanted-JobAggregator/1.0',
                'Accept': 'application/json',
        },
        timeout: 15000,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
    return (data.jobs || []).map(job => normalizeJob(job));
}

function normalizeJob(job) {
    const locationStr = job.jobGeo || job.jobRegion || 'United States';
    const parts = locationStr.split(',').map(s => s.trim());
    const city = parts[0] || '';
    const state = parts[1] || '';

  return {
        id: `jcy_${job.id}`,
        source: 'jobicy',
        title: (job.jobTitle || '').trim(),
        company: job.companyName || '',
        description: (job.jobDescription || '').replace(/<[^>]*>/g, '').substring(0, 1000),
        locationRaw: locationStr,
        city,
        state,
        zip: '',
        lat: null,
        lng: null,
        jobType: job.jobType || 'Full-time',
        salaryMin: job.annualSalaryMin ? parseInt(job.annualSalaryMin) : null,
        salaryMax: job.annualSalaryMax ? parseInt(job.annualSalaryMax) : null,
        salaryText: job.annualSalaryMin ? `$${Number(job.annualSalaryMin).toLocaleString()} - $${Number(job.annualSalaryMax || job.annualSalaryMin).toLocaleString()}` : '',
        applyUrl: job.url || '',
        postedAt: job.pubDate || new Date().toISOString(),
        externalId: String(job.id),
  };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
