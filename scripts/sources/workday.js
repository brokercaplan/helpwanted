/**
 * Workday ATS Job Fetcher
 *
 * Many major employers use Workday for their careers pages.
 * Workday has a public JSON API endpoint per company.
 * No authentication required.
 * Endpoint: https://{company}.wd{n}.myworkdayjobs.com/wday/cxs/{company}/{board}/jobs
 */

import fetch from 'node-fetch';

const DELAY_MS = 400;

// Major employers using Workday - covers retail, food, logistics, healthcare
const WORKDAY_EMPLOYERS = [
  { name: 'Target', tenant: 'target', board: 'Target', instance: 'wd1' },
  { name: 'Home Depot', tenant: 'homedepot', board: 'homedepot', instance: 'wd5' },
  { name: 'CVS Health', tenant: 'cvs', board: 'CVS_Health', instance: 'wd1' },
  { name: 'UPS', tenant: 'upscareers', board: 'UPS', instance: 'wd5' },
  { name: 'FedEx', tenant: 'fedex', board: 'FedEx', instance: 'wd1' },
  { name: 'Bank of America', tenant: 'bofa', board: 'bankofamerica', instance: 'wd1' },
  { name: 'Wells Fargo', tenant: 'wellsfargo', board: 'WellsFargoJobs', instance: 'wd1' },
  { name: 'Kaiser Permanente', tenant: 'kp', board: 'Kaiser_Permanente_External', instance: 'wd5' },
  { name: 'Salesforce', tenant: 'salesforce', board: 'Salesforce', instance: 'wd1' },
  { name: 'Aetna', tenant: 'aetna', board: 'Aetna', instance: 'wd1' },
  { name: 'Kroger', tenant: 'kroger', board: 'Kroger', instance: 'wd5' },
  { name: 'Costco', tenant: 'costco', board: 'CostcoExternalSite', instance: 'wd5' },
  { name: 'Dollar General', tenant: 'dollargeneral', board: 'DollarGeneral', instance: 'wd5' },
  { name: 'Lowe\'s', tenant: 'lowes', board: 'Lowes', instance: 'wd5' },
  { name: 'Best Buy', tenant: 'bestbuy', board: 'BestBuy', instance: 'wd5' },
  { name: 'Starbucks', tenant: 'starbucks', board: 'Starbucks', instance: 'wd5' },
  { name: 'Nike', tenant: 'nike', board: 'Nike', instance: 'wd1' },
  { name: 'Marriott', tenant: 'marriott', board: 'Marriott', instance: 'wd5' },
  { name: 'Hilton', tenant: 'hilton', board: 'Hilton', instance: 'wd5' },
  { name: 'Mayo Clinic', tenant: 'mayoclinic', board: 'MayoClinic', instance: 'wd5' },
  ];

export async function fetchWorkdayJobs() {
    const allJobs = [];
    let successCount = 0;
    let failCount = 0;

  console.log(' Fetching Workday jobs...');

  for (const employer of WORKDAY_EMPLOYERS) {
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

  console.log(` Workday summary: ${successCount} employers found, ${failCount} failed`);
    return allJobs;
}

async function fetchEmployerJobs(employer) {
    const url = `https://${employer.tenant}.${employer.instance}.myworkdayjobs.com/wday/cxs/${employer.tenant}/${employer.board}/jobs`;

  const res = await fetch(url, {
        method: 'POST',
        headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'HelpWanted-JobAggregator/1.0',
        },
        body: JSON.stringify({ limit: 20, offset: 0, searchText: '', locations: [] }),
        timeout: 15000,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
    const jobs = data.jobPostings || data.jobs || [];
    if (!Array.isArray(jobs)) return [];

  return jobs.map(job => normalizeJob(job, employer.name));
}

function normalizeJob(job, companyName) {
    const locationStr = job.locationsText || job.location || '';
    const parts = locationStr.split(',').map(s => s.trim());
    const city = parts[0] || '';
    const state = parts[1] || '';
    const zipMatch = locationStr.match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : '';

  const jobType = detectJobType(job.title, '');
    const externalPath = job.externalPath || job.bulletFields?.[0] || '';
    const applyUrl = externalPath
      ? `https://${companyName.toLowerCase().replace(/\s/g, '')}.myworkdayjobs.com${externalPath}`
          : '';

  return {
        id: `wd_${companyName.replace(/\s/g, '')}_${(job.bulletFields?.[0] || job.title || '').replace(/\//g, '_').substring(0, 30)}`,
        source: 'workday',
        title: (job.title || '').trim(),
        company: companyName,
        description: (job.jobDescription?.replace(/<[^>]+>/g, '') || '').substring(0, 1000),
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
        postedAt: job.postedOn || new Date().toISOString(),
        externalId: job.externalPath || job.title,
  };
}

function detectJobType(title, description) {
    const text = ((title || '') + ' ' + (description || '')).toLowerCase();
    if (text.includes('part-time') || text.includes('part time')) return 'Part-time';
    if (text.includes('contract') || text.includes('freelance')) return 'Contract';
    if (text.includes('intern')) return 'Internship';
    return 'Full-time';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
