/**
 * Lever ATS Job Fetcher
 * 
 * Lever has a public Job Postings API.
 * No authentication required for fetching public job listings.
 * Endpoint: https://api.lever.co/v0/postings/{company}?mode=json
 */

import fetch from 'node-fetch';

const LEVER_API = 'https://api.lever.co/v0/postings';
const DELAY_MS = 300;

export async function fetchLeverJobs(employers) {
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
      failCount++;
    }
    await sleep(DELAY_MS);
  }

  console.log(`    Lever summary: ${successCount} employers found, ${failCount} not on Lever`);
  return allJobs;
}

async function fetchEmployerJobs(slug, companyName) {
  const url = `${LEVER_API}/${slug}?mode=json&limit=250`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'HelpWanted-JobAggregator/1.0' },
    timeout: 10000
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map(job => normalizeLeverJob(job, companyName));
}

function normalizeLeverJob(job, companyName) {
  const locationStr = job.categories?.location || job.country || '';
  const { city, state, zip } = parseLocation(locationStr);
  const { salaryMin, salaryMax, salaryText } = extractSalary(job.descriptionBody || job.description || '');
  const jobType = detectJobType(
    job.categories?.commitment || '',
    job.title,
    job.descriptionBody
  );

  return {
    id: `lv_${job.id}`,
    source: 'lever',
    title: cleanTitle(job.text),
    company: companyName,
    description: stripHtml(job.descriptionBody || job.description || '').substring(0, 1000),
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
    applyUrl: job.hostedUrl || job.applyUrl,
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : new Date().toISOString(),
    externalId: job.id
  };
}

function parseLocation(locationStr) {
  if (!locationStr) return { city: '', state: '', zip: '' };
  const zipMatch = locationStr.match(/\b(\d{5})\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  const parts = locationStr.split(',').map(s => s.trim());
  const city = parts[0] || '';
  const state = parts[1] ? parts[1].replace(/\d{5}/, '').trim() : '';
  return { city, state, zip };
}

function extractSalary(text) {
  if (!text) return { salaryMin: null, salaryMax: null, salaryText: '' };
  const rangeMatch = text.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)/);
  if (rangeMatch) {
    return {
      salaryMin: parseInt(rangeMatch[1].replace(/,/g, '')),
      salaryMax: parseInt(rangeMatch[2].replace(/,/g, '')),
      salaryText: `$${rangeMatch[1]} - $${rangeMatch[2]}`
    };
  }
  const hourlyMatch = text.match(/\$(\d+(?:\.\d+)?)\s*\/\s*(?:hr|hour)/i);
  if (hourlyMatch) {
    const h = parseFloat(hourlyMatch[1]);
    return { salaryMin: h, salaryMax: h, salaryText: `$${h}/hr` };
  }
  return { salaryMin: null, salaryMax: null, salaryText: '' };
}

function detectJobType(commitment, title, description) {
  if (commitment) {
    if (/part.time/i.test(commitment)) return 'Part-time';
    if (/contract/i.test(commitment)) return 'Contract';
    if (/intern/i.test(commitment)) return 'Internship';
    if (/full.time/i.test(commitment)) return 'Full-time';
  }
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
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
