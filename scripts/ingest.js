/**
 * Help Wanted - Daily Job Ingestion Script
 *
 * Runs once per day via GitHub Actions.
 * Pulls from multiple free sources, geocodes by zip code,
 * and writes the aggregated database to Cloudflare KV.
 *
 * Sources: Greenhouse, Lever, Adzuna, RemoteOK, CareerJet, Workday, iCIMS
 */

import { fetchGreenhouseJobs } from './sources/greenhouse.js';
import { fetchLeverJobs } from './sources/lever.js';
import { fetchAdzunaJobs } from './sources/adzuna.js';
import { fetchRemoteOKJobs } from './sources/remotework.js';
import { fetchCareerjetJobs } from './sources/careerjet.js';
import { fetchWorkdayJobs } from './sources/workday.js';
import { fetchIcimsJobs } from './sources/icims.js';
import { geocodeJobs } from './utils/geocode.js';
import { deduplicateJobs } from './utils/dedupe.js';
import { writeToCloudflareKV } from './utils/cloudflare.js';
import { readFileSync, writeFileSync } from 'fs';

const employers = JSON.parse(readFileSync('./employers.json', 'utf-8'));

async function main() {
    console.log('=== Help Wanted Job Ingestion ===');
    console.log(`Started: ${new Date().toISOString()}`);

  const allJobs = [];
    const report = { sources: {}, total: 0, errors: [] };

  // --- Greenhouse ---
  try {
        console.log('\n[1/7] Greenhouse ATS...');
        const jobs = await fetchGreenhouseJobs(employers.filter(e => e.greenhouse));
        allJobs.push(...jobs);
        report.sources.greenhouse = jobs.length;
        console.log(`Greenhouse: ${jobs.length} jobs`);
  } catch (err) {
        report.errors.push({ source: 'greenhouse', error: err.message });
        console.error('Greenhouse failed:', err.message);
  }

  // --- Lever ---
  try {
        console.log('\n[2/7] Lever ATS...');
        const jobs = await fetchLeverJobs(employers.filter(e => e.lever));
        allJobs.push(...jobs);
        report.sources.lever = jobs.length;
        console.log(`Lever: ${jobs.length} jobs`);
  } catch (err) {
        report.errors.push({ source: 'lever', error: err.message });
        console.error('Lever failed:', err.message);
  }

  // --- Adzuna ---
  try {
        console.log('\n[3/7] Adzuna API...');
        const jobs = await fetchAdzunaJobs();
        allJobs.push(...jobs);
        report.sources.adzuna = jobs.length;
        console.log(`Adzuna: ${jobs.length} jobs`);
  } catch (err) {
        report.errors.push({ source: 'adzuna', error: err.message });
        console.error('Adzuna failed:', err.message);
  }

  // --- RemoteOK ---
  try {
        console.log('\n[4/7] RemoteOK...');
        const jobs = await fetchRemoteOKJobs();
        allJobs.push(...jobs);
        report.sources.remoteok = jobs.length;
        console.log(`RemoteOK: ${jobs.length} jobs`);
  } catch (err) {
        report.errors.push({ source: 'remoteok', error: err.message });
        console.error('RemoteOK failed:', err.message);
  }

  // --- CareerJet ---
  try {
        console.log('\n[5/7] CareerJet...');
        const jobs = await fetchCareerjetJobs();
        allJobs.push(...jobs);
        report.sources.careerjet = jobs.length;
        console.log(`CareerJet: ${jobs.length} jobs`);
  } catch (err) {
        report.errors.push({ source: 'careerjet', error: err.message });
        console.error('CareerJet failed:', err.message);
  }

  // --- Workday ---
  try {
        console.log('\n[6/7] Workday (Target, Home Depot, CVS, UPS, etc.)...');
        const jobs = await fetchWorkdayJobs();
        allJobs.push(...jobs);
        report.sources.workday = jobs.length;
        console.log(`Workday: ${jobs.length} jobs`);
  } catch (err) {
        report.errors.push({ source: 'workday', error: err.message });
        console.error('Workday failed:', err.message);
  }

  // --- iCIMS ---
  try {
        console.log('\n[7/7] iCIMS (Chipotle, Panera, Dollar Tree, etc.)...');
        const jobs = await fetchIcimsJobs();
        allJobs.push(...jobs);
        report.sources.icims = jobs.length;
        console.log(`iCIMS: ${jobs.length} jobs`);
  } catch (err) {
        report.errors.push({ source: 'icims', error: err.message });
        console.error('iCIMS failed:', err.message);
  }

  console.log(`\nTotal before dedup: ${allJobs.length} jobs`);

  // --- Deduplicate ---
  const uniqueJobs = deduplicateJobs(allJobs);
    console.log(`After dedup: ${uniqueJobs.length} unique jobs`);
    report.total = uniqueJobs.length;

  // --- Geocode ---
  console.log('\nGeocoding jobs by zip...');
    const geocodedJobs = await geocodeJobs(uniqueJobs);
    console.log(`Geocoded: ${geocodedJobs.length} jobs`);

  // --- Write to Cloudflare KV ---
  console.log('\nWriting to Cloudflare KV...');
    await writeToCloudflareKV(geocodedJobs);
    console.log('Done writing to KV.');

  // --- Save report ---
  report.completedAt = new Date().toISOString();
    writeFileSync('./ingestion-report.json', JSON.stringify(report, null, 2));

  console.log('\n=== Ingestion Complete ===');
    console.log(JSON.stringify(report.sources, null, 2));
    console.log(`Total unique jobs: ${report.total}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
