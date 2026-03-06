/**
 * Arbeitnow Job Fetcher (replaces Workday scraper)
 * Free public API - no key required
 * Returns thousands of real job listings
 * Docs: https://www.arbeitnow.com/api
 */
import fetch from 'node-fetch';

const BASE_URL = 'https://www.arbeitnow.com/api/job-board-api';
const PAGES_TO_FETCH = 10; // 10 jobs per page

export async function fetchWorkdayJobs() {
    const allJobs = [];

  console.log('  Fetching Arbeitnow jobs...');

  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
        try {
                const url = new URL(BASE_URL);
                url.searchParams.set('page', page);

          const res = await fetch(url.toString(), {
                    headers: {
                                'User-Agent': 'HelpWanted-JobAggregator/1.0',
                                'Accept': 'application/json',
                    },
                    timeout: 15000,
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json();
                const jobs = (data.data || []).map(job => normalizeJob(job));

          if (jobs.length === 0) break;
                allJobs.push(...jobs);
                await sleep(400);
        } catch (err) {
                console.error(`  Arbeitnow page ${page} error: ${err.message}`);
                break;
        }
  }

  console.log(`  Arbeitnow: ${allJobs.length} jobs fetched`);
    return allJobs;
}

function normalizeJob(job) {
    const locationStr = job.location || '';
    const parts = locationStr.split(',').map(s => s.trim());
    const city = parts[0] || '';
    const state = parts[1] || '';

  return {
        id: `arb_${job.slug || job.title?.replace(/\s+/g, '-').toLowerCase()}`,
        source: 'arbeitnow',
        title: (job.title || '').trim(),
        company: job.company_name || '',
                          description: (job.description || '').replace(/<[^>]*>/g, '').substring(0, 1000),
        locationRaw: locationStr,
        city,
        state,
        zip: '',
        lat: null,
        lng: null,
        jobType: job.remote ? 'Remote' : 'Full-time',
        salaryMin: null,
        salaryMax: null,
        salaryText: '',
        applyUrl: job.url || '',
        postedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : new Date().toISOString(),
        externalId: job.slug || job.title,
  };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
