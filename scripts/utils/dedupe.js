/**
 * Deduplication Utility
 * Removes duplicate jobs from multiple sources.
 * Uses composite key of: normalized title + company + location
 */

export function deduplicateJobs(jobs) {
  const seen = new Map();
  const unique = [];

  for (const job of jobs) {
    // Primary key: source-specific ID (most reliable)
    if (job.id && seen.has(job.id)) continue;

    // Secondary key: title + company + zip (catches cross-source duplicates)
    const compositeKey = makeCompositeKey(job);
    if (seen.has(compositeKey)) continue;

    // Mark both keys as seen
    if (job.id) seen.set(job.id, true);
    seen.set(compositeKey, true);
    unique.push(job);
  }

  return unique;
}

function makeCompositeKey(job) {
  const title = normalizeText(job.title);
  const company = normalizeText(job.company);
  const location = job.zip || normalizeText(job.city);
  return `${title}|${company}|${location}`;
}

function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 50);
}
