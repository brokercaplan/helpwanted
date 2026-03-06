/**
 * Help Wanted - Daily Job Ingestion Script
 * 
 * Runs once per day via GitHub Actions.
 * Pulls from multiple free sources, geocodes by zip code,
 * and writes the aggregated database to Cloudflare KV.
 * 
 * API calls are batched and rate-limited to respect free tiers.
 */

import { fetchGreenhouseJobs } from './sources/greenhouse.js';
import { fetchLeverJobs } from './sources/lever.js';
import { fetchUSAJobs } from './sources/usajobs.js';
import { fetchAdzunaJobs } from './sources/adzuna.js';
import { fetchRemoteOKJobs } from './sources/remotework.js';
import { geocodeJobs } from './utils/geocode.js';
import { deduplicateJobs } from './utils/dedupe.js';
import { writeToCloudflareKV } from './utils/cloudflare.js';
import { readFileSync, writeFileSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');
const START_TIME = Date.now();

const report = {
  date: new Date().toISOString(),
  dryRun: DRY_RUN,
  sources: {},
  totals: { fetched: 0, geocoded: 0, deduplicated: 0, written: 0 },
  errors: [],
  duration_ms: 0
};

async function run() {
  console.log('=================================');
  console.log('Help Wanted - Daily Job Ingestion');
  console.log(`Started: ${report.date}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log('=================================\n');

  // Load employer list
  const employers = JSON.parse(readFileSync('../employers.json', 'utf8'));

  let allJobs = [];

  // -----------------------------------------------
  // SOURCE 1: Greenhouse ATS (free, no key, unlimited)
  // -----------------------------------------------
  try {
    console.log('Fetching from Greenhouse ATS...');
    const ghJobs = await fetchGreenhouseJobs(employers.greenhouse);
    report.sources.greenhouse = { count: ghJobs.length, status: 'ok' };
    allJobs = allJobs.concat(ghJobs);
    console.log(`  Greenhouse: ${ghJobs.length} jobs\n`);
  } catch (err) {
    report.sources.greenhouse = { count: 0, status: 'error', error: err.message };
    report.errors.push({ source: 'greenhouse', error: err.message });
    console.error(`  Greenhouse error: ${err.message}\n`);
  }

  // -----------------------------------------------
  // SOURCE 2: Lever ATS (free, no key, unlimited)
  // -----------------------------------------------
  try {
    console.log('Fetching from Lever ATS...');
    const leverJobs = await fetchLeverJobs(employers.lever);
    report.sources.lever = { count: leverJobs.length, status: 'ok' };
    allJobs = allJobs.concat(leverJobs);
    console.log(`  Lever: ${leverJobs.length} jobs\n`);
  } catch (err) {
    report.sources.lever = { count: 0, status: 'error', error: err.message };
    report.errors.push({ source: 'lever', error: err.message });
    console.error(`  Lever error: ${err.message}\n`);
  }

  // -----------------------------------------------
  // SOURCE 3: USAJobs (free key, 10K/day — use 1 batch)
  // -----------------------------------------------
  if (process.env.USAJOBS_API_KEY) {
    try {
      console.log('Fetching from USAJobs...');
      const usaJobs = await fetchUSAJobs();
      report.sources.usajobs = { count: usaJobs.length, status: 'ok' };
      allJobs = allJobs.concat(usaJobs);
      console.log(`  USAJobs: ${usaJobs.length} jobs\n`);
    } catch (err) {
      report.sources.usajobs = { count: 0, status: 'error', error: err.message };
      report.errors.push({ source: 'usajobs', error: err.message });
      console.error(`  USAJobs error: ${err.message}\n`);
    }
  } else {
    console.log('  USAJobs: Skipped (no API key)\n');
    report.sources.usajobs = { count: 0, status: 'skipped', reason: 'No API key' };
  }

  // -----------------------------------------------
  // SOURCE 4: Adzuna (free tier, 250 req/day — use ONCE, broad search)
  // -----------------------------------------------
  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) {
    try {
      console.log('Fetching from Adzuna (1 broad call for the day)...');
      const adzunaJobs = await fetchAdzunaJobs();
      report.sources.adzuna = { count: adzunaJobs.length, status: 'ok' };
      allJobs = allJobs.concat(adzunaJobs);
      console.log(`  Adzuna: ${adzunaJobs.length} jobs\n`);
    } catch (err) {
      report.sources.adzuna = { count: 0, status: 'error', error: err.message };
      report.errors.push({ source: 'adzuna', error: err.message });
      console.error(`  Adzuna error: ${err.message}\n`);
    }
  } else {
    console.log('  Adzuna: Skipped (no API key)\n');
    report.sources.adzuna = { count: 0, status: 'skipped', reason: 'No API key' };
  }

  // -----------------------------------------------
  // SOURCE 5: RemoteOK (free, no key)
  // -----------------------------------------------
  try {
    console.log('Fetching from RemoteOK...');
    const remoteJobs = await fetchRemoteOKJobs();
    report.sources.remoteok = { count: remoteJobs.length, status: 'ok' };
    allJobs = allJobs.concat(remoteJobs);
    console.log(`  RemoteOK: ${remoteJobs.length} jobs\n`);
  } catch (err) {
    report.sources.remoteok = { count: 0, status: 'error', error: err.message };
    report.errors.push({ source: 'remoteok', error: err.message });
    console.error(`  RemoteOK error: ${err.message}\n`);
  }

  report.totals.fetched = allJobs.length;
  console.log(`\nTotal fetched: ${allJobs.length} jobs`);

  // -----------------------------------------------
  // STEP 2: Geocode - convert locations to lat/lng + zip
  // -----------------------------------------------
  console.log('\nGeocoding jobs...');
  const geocodedJobs = await geocodeJobs(allJobs);
  report.totals.geocoded = geocodedJobs.length;
  console.log(`Geocoded: ${geocodedJobs.length} jobs\n`);

  // -----------------------------------------------
  // STEP 3: Deduplicate
  // -----------------------------------------------
  console.log('Deduplicating...');
  const uniqueJobs = deduplicateJobs(geocodedJobs);
  report.totals.deduplicated = uniqueJobs.length;
  console.log(`After dedup: ${uniqueJobs.length} unique jobs\n`);

  // -----------------------------------------------
  // STEP 4: Index by zip code for fast lookups
  // -----------------------------------------------
  console.log('Building zip code index...');
  const zipIndex = buildZipIndex(uniqueJobs);
  const zipCount = Object.keys(zipIndex).length;
  console.log(`Indexed ${uniqueJobs.length} jobs across ${zipCount} zip codes\n`);

  // -----------------------------------------------
  // STEP 5: Write to Cloudflare KV
  // -----------------------------------------------
  if (!DRY_RUN) {
    console.log('Writing to Cloudflare KV...');
    const writeResult = await writeToCloudflareKV(zipIndex, uniqueJobs);
    report.totals.written = writeResult.written;
    console.log(`Written: ${writeResult.written} KV entries\n`);
  } else {
    console.log('[DRY RUN] Skipping Cloudflare KV write\n');
    console.log('Sample output (first 2 zips):');
    const sampleZips = Object.keys(zipIndex).slice(0, 2);
    sampleZips.forEach(zip => {
      console.log(`  ${zip}: ${zipIndex[zip].length} jobs`);
    });
  }

  // -----------------------------------------------
  // STEP 6: Write report
  // -----------------------------------------------
  report.duration_ms = Date.now() - START_TIME;
  console.log('\n=================================');
  console.log('INGESTION COMPLETE');
  console.log(`Duration: ${(report.duration_ms / 1000).toFixed(1)}s`);
  console.log(`Fetched: ${report.totals.fetched}`);
  console.log(`Geocoded: ${report.totals.geocoded}`);
  console.log(`Unique: ${report.totals.deduplicated}`);
  if (!DRY_RUN) console.log(`Written: ${report.totals.written}`);
  if (report.errors.length > 0) {
    console.log(`Errors: ${report.errors.length}`);
    report.errors.forEach(e => console.log(`  - ${e.source}: ${e.error}`));
  }
  console.log('=================================');

  writeFileSync('ingestion-report.json', JSON.stringify(report, null, 2));
}

/**
 * Build a zip-code-indexed structure for fast location searches.
 * Structure: { "33139": [job, job, ...], "10001": [job, ...] }
 */
function buildZipIndex(jobs) {
  const index = {};
  for (const job of jobs) {
    if (!job.zip) continue;
    if (!index[job.zip]) index[job.zip] = [];
    index[job.zip].push({
      id: job.id,
      title: job.title,
      company: job.company,
      jobType: job.jobType,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryText: job.salaryText,
      city: job.city,
      state: job.state,
      zip: job.zip,
      lat: job.lat,
      lng: job.lng,
      applyUrl: job.applyUrl,
      postedAt: job.postedAt,
      source: job.source,
      description: job.description ? job.description.substring(0, 500) : ''
    });
  }
  return index;
}

run().catch(err => {
  console.error('Fatal error:', err);
  report.errors.push({ source: 'main', error: err.message });
  report.duration_ms = Date.now() - START_TIME;
  writeFileSync('ingestion-report.json', JSON.stringify(report, null, 2));
  process.exit(1);
});
