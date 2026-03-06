/**
 * Cloudflare KV Writer
 *
 * Writes the job database to Cloudflare Workers KV.
 * Uses the Cloudflare REST API with an API token.
 *
 * KV Structure:
 *   jobs:zip:{zipcode} -> JSON array of jobs in that zip
 *   jobs:meta         -> { lastUpdated, totalJobs, totalZips }
 *   jobs:all          -> JSON array of ALL jobs (for global search)
 */
import fetch from 'node-fetch';

const CF_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * @param {Array} allJobs - flat array of job objects
 */
export async function writeToCloudflareKV(allJobs) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;

  if (!accountId || !apiToken || !namespaceId) {
        console.log('  Cloudflare: Missing credentials - skipping KV write');
        return { written: 0 };
  }

  if (!Array.isArray(allJobs) || allJobs.length === 0) {
        console.log('  Cloudflare: No jobs to write');
        return { written: 0 };
  }

  const headers = {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
  };

  // Build zip index from flat jobs array
  const zipIndex = {};
    for (const job of allJobs) {
          const zip = (job.zip || 'unknown').toString().trim() || 'unknown';
          if (!zipIndex[zip]) zipIndex[zip] = [];
          zipIndex[zip].push(job);
    }

  const zips = Object.keys(zipIndex);
    console.log(`  Writing ${zips.length} zip code buckets to Cloudflare KV...`);

  // Write zip buckets in batches (KV bulk API allows up to 10,000 keys per request)
  const BATCH_SIZE = 100;
    let written = 0;

  for (let i = 0; i < zips.length; i += BATCH_SIZE) {
        const batch = zips.slice(i, i + BATCH_SIZE);
        const kvPairs = batch.map(zip => ({
                key: `jobs:zip:${zip}`,
                value: JSON.stringify(zipIndex[zip]),
                expiration_ttl: 90000, // ~25 hours
        }));

      const res = await fetch(
              `${CF_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
        {
                  method: 'PUT',
                  headers,
                  body: JSON.stringify(kvPairs),
        }
            );

      if (!res.ok) {
              const err = await res.text();
              console.error(`  KV bulk write error: ${err}`);
      } else {
              written += batch.length;
      }

      await sleep(200);
  }

  // Write "jobs:all" as a full dump (up to 25MB KV value limit)
  // Chunk into groups of 500 to stay well under limit
  const ALL_CHUNK = 500;
    for (let i = 0; i < allJobs.length; i += ALL_CHUNK) {
          const chunk = allJobs.slice(i, i + ALL_CHUNK);
          const chunkKey = `jobs:all:${Math.floor(i / ALL_CHUNK)}`;
          await fetch(
                  `${CF_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${chunkKey}`,
            {
                      method: 'PUT',
                      headers: { 'Authorization': `Bearer ${apiToken}` },
                      body: JSON.stringify(chunk),
            }
                );
          await sleep(100);
    }

  // Write metadata
  const meta = {
        lastUpdated: new Date().toISOString(),
        totalJobs: allJobs.length,
        totalZips: zips.length,
        totalChunks: Math.ceil(allJobs.length / ALL_CHUNK),
        sources: [...new Set(allJobs.map(j => j.source))],
  };

  await fetch(
        `${CF_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/jobs:meta`,
    {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${apiToken}` },
            body: JSON.stringify(meta),
    }
      );

  console.log(`  KV write complete: ${written} zip entries + metadata + all-jobs chunks`);
    return { written };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
