/**
 * Greenhouse ATS Job Fetcher
 * 
 * Greenhouse has a completely public Job Board API.
 * No authentication required. No rate limits documented.
 * Endpoint: https://boards-api.greenhouse.io/v1/boards/{company}/jobs
 * 
 * We fetch all jobs per employer and normalize the data format.
 */

import fetch from 'node-fetch';

const GREENHOUSE_API = 'https://boards-api.greenhouse.io/v1/boards';
const DELAY_MS = 300; // Be polite - wait 300ms between requests

/**
 * Fetch jobs from all Greenhouse employers in our list
 */
export async function fetchGreenhouseJobs(employers) {
  const allJobs = [];
  let successCount = 0;
  let failCount = 0;

  for (const employer of employers) {
    try {
      const jobs = await fetchEmployerJobs(employer.slug, employer.name);
      allJobs.push(...jobs);
      successCount++;
      if (jobs.length > 0) {
        process.stdout.write(`    ✓ ${employer.name}: ${jobs.length} jobs\n`);
      }
    } catch (err) {
      // Many slugs won't exist - that's fine, just skip
      failCount++;
    }
    // Rate limit: small delay between requests
    await sleep(DELAY_MS);
  }

  console.log(`    Greenhouse summary: ${successCount} employers found, ${failCount} not on Greenhouse`);
  return allJobs;
}

async function fetchEmployerJobs(slug, companyName) {
  const url = `${GREENHOUSE_API}/${slug}/jobs?content=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'HelpWanted-JobAggregator/1.0' },
    timeout: 10000
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.jobs || !Array.isArray(data.jobs)) return [];

  return data.jobs.map(job => normalizeGreenhouseJob(job, companyName, slug));
}

function normalizeGreenhouseJob(job, companyName, slug) {
  // Extract location info
  const locationStr = job.location?.name || '';
  const { city, state, zip } = parseLocation(locationStr);

  // Extract salary from description if present
  const { salaryMin, salaryMax, salaryText } = extractSalary(job.content || '');

  // Determine job type
  const jobType = detectJobType(job.title, job.content);

  return {
    id: `gh_${slug}_${job.id}`,
    source: 'greenhouse',
    title: cleanTitle(job.title),
    company: companyName,
    description: stripHtml(job.content || '').substring(0, 1000),
    locationRaw: locationStr,
    city,
    state,
    zip,
    lat: null,
    lng: null,
    jobType,
    salaryMin,
    salaryMax,
    salaryText,
    applyUrl: job.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${job.id}`,
    postedAt: job.updated_at || new Date().toISOString(),
    externalId: String(job.id)
  };
}

function parseLocation(locationStr) {
  if (!locationStr) return { city: '', state: '', zip: '' };
  
  // Try to extract zip code
  const zipMatch = locationStr.match(/\b(\d{5})\b/);
  const zip = zipMatch ? zipMatch[1] : '';

  // Try city, state format
  const parts = locationStr.split(',').map(s => s.trim());
  const city = parts[0] || '';
  const state = parts[1] ? parts[1].replace(/\d{5}/, '').trim() : '';

  return { city, state, zip };
}

function extractSalary(text) {
  if (!text) return { salaryMin: null, salaryMax: null, salaryText: '' };
  
  // Match patterns like $50,000 - $70,000 or $25/hr
  const rangeMatch = text.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1].replace(/,/g, ''));
    const max = parseInt(rangeMatch[2].replace(/,/g, ''));
    return { salaryMin: min, salaryMax: max, salaryText: `$${rangeMatch[1]} - $${rangeMatch[2]}` };
  }

  const hourlyMatch = text.match(/\$(\d+(?:\.\d+)?)\s*\/\s*(?:hr|hour)/i);
  if (hourlyMatch) {
    const hourly = parseFloat(hourlyMatch[1]);
    return { salaryMin: hourly, salaryMax: hourly, salaryText: `$${hourly}/hr` };
  }

  return { salaryMin: null, salaryMax: null, salaryText: '' };
}

function detectJobType(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (text.includes('part-time') || text.includes('part time')) return 'Part-time';
  if (text.includes('contract') || text.includes('freelance')) return 'Contract';
  if (text.includes('intern')) return 'Internship';
  return 'Full-time';
}

function cleanTitle(title) {
  return (title || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
