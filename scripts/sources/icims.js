/**
 * iCIMS ATS Job Fetcher
 *
 * iCIMS is used by many large retail, food service, and hospitality employers.
 * They have a public JSON API per company - no authentication required.
 * Endpoint: https://careers-{company}.icims.com/jobs/search?ss=1&searchCategory=0&in_iframe=1&pr=0&jbi=0&js=1
 */

import fetch from 'node-fetch';

const DELAY_MS = 400;

// Major employers using iCIMS
const ICIMS_EMPLOYERS = [
  { name: 'Chipotle', subdomain: 'careers-chipotle' },
  { name: 'Dunkin', subdomain: 'careers-dunkin' },
  { name: 'Panera Bread', subdomain: 'careers-panerabread' },
  { name: "Domino's", subdomain: 'careers-dominos' },
  { name: 'Papa Johns', subdomain: 'careers-papajohns' },
  { name: 'Sonic Drive-In', subdomain: 'careers-sonicdrivein' },
  { name: 'Applebees', subdomain: 'careers-applebees' },
  { name: 'IHOP', subdomain: 'careers-ihop' },
  { name: 'Red Robin', subdomain: 'careers-redrobin' },
  { name: 'Olive Garden', subdomain: 'careers-olivegarden' },
  { name: 'Darden Restaurants', subdomain: 'careers-darden' },
  { name: 'Dollar Tree', subdomain: 'careers-dollartree' },
  { name: 'Family Dollar', subdomain: 'careers-familydollar' },
  { name: 'AutoZone', subdomain: 'careers-autozone' },
  { name: "O'Reilly Auto Parts", subdomain: 'careers-oreillyauto' },
  { name: 'Advance Auto Parts', subdomain: 'careers-advanceautoparts' },
  { name: 'Petco', subdomain: 'careers-petco' },
  { name: 'PetSmart', subdomain: 'careers-petsmart' },
  { name: 'Michaels', subdomain: 'careers-michaels' },
  { name: 'Party City', subdomain: 'careers-partycity' },
  ];

export async function fetchIcimsJobs() {
    const allJobs = [];
    let successCount = 0;
    let failCount = 0;

  console.log(' Fetching iCIMS jobs...');

  for (const employer of ICIMS_EMPLOYERS) {
        try {
                const jobs = await fetchEmployerJobs(employer);
                if (jobs.length > 0) {
                          allJobs.push(...jobs);
                          successCount++;
                          process.stdout.write(` ✓ ${employer.name}: ${jobs.length} jobs\n`);
                }
        } catch (err) {
                failCount++;
        }
        await sleep(DELAY_MS);
  }

  console.log(` iCIMS summary: ${successCount} employers found, ${failCount} failed`);
    return allJobs;
}

async function fetchEmployerJobs(employer) {
    const url = `https://${employer.subdomain}.icims.com/jobs/search?ss=1&searchCategory=0&in_iframe=1&pr=0&jbi=0&js=1&hfields=id,jobtitle,joblocation,jobtype,jobposting`;

  const res = await fetch(url, {
        headers: {
                'User-Agent': 'HelpWanted-JobAggregator/1.0',
                'Accept': 'application/json',
        },
        timeout: 12000,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // iCIMS returns either JSON or HTML - try JSON first
  const text = await res.text();
    let jobs = [];

  try {
        const data = JSON.parse(text);
        jobs = data.searchResults || data.jobs || data.items || [];
  } catch {
        // If not JSON, try to parse job links from HTML
      const matches = text.matchAll(/href="(https:\/\/[^"]*icims\.com\/jobs\/(\d+)\/[^"]+)"/g);
        for (const match of matches) {
                jobs.push({ url: match[1], id: match[2] });
        }
  }

  if (!Array.isArray(jobs) || jobs.length === 0) return [];

  return jobs.slice(0, 20).map(job => normalizeJob(job, employer));
}

function normalizeJob(job, employer) {
    const title = job.jobtitle || job.title || job.name || 'Position Available';
    const locationStr = job.joblocation || job.location || '';
    const parts = locationStr.split(',').map(s => s.trim());
    const city = parts[0] || '';
    const state = parts[1] || '';
    const zipMatch = locationStr.match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : '';
    const jobType = detectJobType(title, job.jobtype || '');
    const applyUrl = job.url || `https://${employer.subdomain}.icims.com/jobs/${job.id}/job`;

  return {
        id: `icims_${employer.subdomain}_${job.id || title.replace(/\s/g, '_').substring(0, 20)}`,
        source: 'icims',
        title: title.trim(),
        company: employer.name,
        description: (job.description || job.jobdescription || '').replace(/<[^>]+>/g, '').substring(0, 1000),
        locationRaw: locationStr,
        city,
        state,
        zip,
        lat: null,
        lng: null,
        jobType,
        salaryMin: null,
        salaryMax: null,
        salaryText: '',
        applyUrl,
        postedAt: job.posteddate || job.date || new Date().toISOString(),
        externalId: String(job.id || title),
  };
}

function detectJobType(title, jobtype) {
    const text = ((title || '') + ' ' + (jobtype || '')).toLowerCase();
    if (text.includes('part-time') || text.includes('part time') || text.includes('parttime')) return 'Part-time';
    if (text.includes('contract') || text.includes('freelance')) return 'Contract';
    if (text.includes('intern')) return 'Internship';
    return 'Full-time';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
