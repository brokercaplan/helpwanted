/**
 * RemoteOK API Fetcher
 * Completely free, no API key required.
 * Returns remote job listings globally.
 */

import fetch from 'node-fetch';

const REMOTEOK_URL = 'https://remoteok.com/api';

export async function fetchRemoteOKJobs() {
  try {
    const res = await fetch(REMOTEOK_URL, {
      headers: {
        'User-Agent': 'HelpWanted-JobAggregator/1.0',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    // First item is metadata, rest are jobs
    const jobs = Array.isArray(data) ? data.slice(1) : [];
    
    return jobs
      .filter(job => job.id && job.position)
      .map(normalizeRemoteOKJob);
  } catch (err) {
    console.error(`    RemoteOK error: ${err.message}`);
    return [];
  }
}

function normalizeRemoteOKJob(job) {
  return {
    id: `ro_${job.id}`,
    source: 'remoteok',
    title: job.position || '',
    company: job.company || '',
    description: stripHtml(job.description || '').substring(0, 1000),
    locationRaw: 'Remote',
    city: 'Remote',
    state: '',
    zip: '',
    lat: null,
    lng: null,
    jobType: 'Remote',
    salaryMin: job.salary_min || null,
    salaryMax: job.salary_max || null,
    salaryText: job.salary_min ? `$${job.salary_min.toLocaleString()} - $${(job.salary_max || job.salary_min).toLocaleString()}` : '',
    applyUrl: job.url || `https://remoteok.com/remote-jobs/${job.id}`,
    postedAt: job.date || new Date().toISOString(),
    externalId: String(job.id)
  };
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
