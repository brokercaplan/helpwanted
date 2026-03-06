/**
 * CareerJet Job Fetcher
 *
 * CareerJet has a free public API - no key required.
 * Returns jobs by location/zip. Great volume of local jobs.
 * Endpoint: http://public.api.careerjet.net/search
 */

import fetch from 'node-fetch';

const CAREERJET_API = 'http://public.api.careerjet.net/search';
const DELAY_MS = 500;

// Sample of US zip codes to pull jobs from (major metros + spread)
const ZIP_CODES = [
    '10001','10002','10003','10011','10036', // NYC
    '90001','90010','90025','90210','91001', // LA
    '60601','60602','60610','60614','60622', // Chicago
    '77001','77002','77010','77024','77056', // Houston
    '85001','85004','85012','85016','85254', // Phoenix
    '19101','19102','19103','19106','19130', // Philadelphia
    '78201','78202','78205','78209','78212', // San Antonio
    '92101','92102','92103','92108','92117', // San Diego
    '75201','75202','75204','75206','75214', // Dallas
    '95101','95110','95112','95116','95126', // San Jose
    '30301','30303','30306','30308','30312', // Atlanta
    '98101','98102','98103','98104','98115', // Seattle
    '02101','02108','02110','02115','02134', // Boston
    '80201','80202','80203','80205','80210', // Denver
    '28201','28202','28203','28204','28205', // Charlotte
    '97201','97202','97203','97210','97214', // Portland
    '35201','35203','35205','35209','35213', // Birmingham
    '33101','33125','33130','33132','33136', // Miami
    '55401','55402','55403','55404','55408', // Minneapolis
    '70112','70113','70115','70116','70117', // New Orleans
  ];

export async function fetchCareerjetJobs() {
    const allJobs = [];
    let totalFetched = 0;

  console.log(' Fetching CareerJet jobs by zip code...');

  for (const zip of ZIP_CODES) {
        try {
                const jobs = await fetchByZip(zip);
                allJobs.push(...jobs);
                totalFetched += jobs.length;
        } catch (err) {
                // skip on error
        }
        await sleep(DELAY_MS);
  }

  console.log(` CareerJet: ${totalFetched} jobs across ${ZIP_CODES.length} zip codes`);
    return deduplicateJobs(allJobs);
}

async function fetchByZip(zip) {
    const params = new URLSearchParams({
          affid: 'e15c8e8e7b4456e16e89e31b7bd9a43e', // public test affid
          user_ip: '1.1.1.1',
          url: 'http://www.example.com',
          user_agent: 'HelpWanted-JobAggregator/1.0',
          keywords: '',
          location: zip,
          sort: 'date',
          contracttype: '',
          contractperiod: '',
          pagesize: '20',
          page: '1',
    });

  const res = await fetch(`${CAREERJET_API}?${params}`, {
        headers: { 'User-Agent': 'HelpWanted-JobAggregator/1.0' },
        timeout: 10000,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
    if (!data.jobs || !Array.isArray(data.jobs)) return [];

  return data.jobs.map(job => normalizeJob(job, zip));
}

function normalizeJob(job, zip) {
    const locationStr = job.locations || '';
    const parts = locationStr.split(',').map(s => s.trim());
    const city = parts[0] || '';
    const state = parts[1] || '';

  const { salaryMin, salaryMax, salaryText } = extractSalary(job.salary || '');
    const jobType = detectJobType(job.title, job.description);

  return {
        id: `cj_${Buffer.from(job.url || job.title).toString('base64').substring(0, 20)}`,
        source: 'careerjet',
        title: (job.title || '').trim(),
        company: job.company || 'Unknown',
        description: (job.description || '').substring(0, 1000),
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
        applyUrl: job.url || '',
        postedAt: job.date || new Date().toISOString(),
        externalId: job.url || job.title,
  };
}

function extractSalary(text) {
    if (!text) return { salaryMin: null, salaryMax: null, salaryText: '' };
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
    return { salaryMin: null, salaryMax: null, salaryText: text.substring(0, 50) };
}

function detectJobType(title, description) {
    const text = ((title || '') + ' ' + (description || '')).toLowerCase();
    if (text.includes('part-time') || text.includes('part time')) return 'Part-time';
    if (text.includes('contract') || text.includes('freelance')) return 'Contract';
    if (text.includes('intern')) return 'Internship';
    return 'Full-time';
}

function deduplicateJobs(jobs) {
    const seen = new Set();
    return jobs.filter(job => {
          const key = job.externalId || job.id;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
