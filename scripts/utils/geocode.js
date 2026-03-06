/**
 * Geocoding Utility
 * 
 * Converts city/state/location strings to lat/lng + zip code.
 * Uses US Census Bureau Geocoding API (free, no key needed).
 * Also uses a pre-loaded zip code lookup table for common cities.
 */

import fetch from 'node-fetch';

const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

// Cache geocoding results to avoid redundant calls
const geocodeCache = new Map();

// Known major city/state to zip mapping (reduces API calls for common cities)
const CITY_ZIP_LOOKUP = {
  'miami, fl': '33101', 'miami beach, fl': '33139', 'miami, florida': '33101',
  'brickell, fl': '33131', 'wynwood, fl': '33127', 'little havana, fl': '33135',
  'coral gables, fl': '33134', 'doral, fl': '33178', 'hialeah, fl': '33010',
  'new york, ny': '10001', 'new york, new york': '10001', 'manhattan, ny': '10001',
  'brooklyn, ny': '11201', 'queens, ny': '11354', 'bronx, ny': '10451',
  'los angeles, ca': '90001', 'los angeles, california': '90001', 'la, ca': '90001',
  'chicago, il': '60601', 'chicago, illinois': '60601',
  'houston, tx': '77001', 'houston, texas': '77001',
  'phoenix, az': '85001', 'phoenix, arizona': '85001',
  'philadelphia, pa': '19101', 'philadelphia, pennsylvania': '19101',
  'san antonio, tx': '78201', 'san diego, ca': '92101',
  'dallas, tx': '75201', 'dallas, texas': '75201',
  'san jose, ca': '95101', 'san francisco, ca': '94102',
  'austin, tx': '78701', 'austin, texas': '78701',
  'seattle, wa': '98101', 'seattle, washington': '98101',
  'denver, co': '80201', 'denver, colorado': '80201',
  'boston, ma': '02101', 'boston, massachusetts': '02101',
  'atlanta, ga': '30301', 'atlanta, georgia': '30301',
  'las vegas, nv': '89101', 'las vegas, nevada': '89101',
  'nashville, tn': '37201', 'nashville, tennessee': '37201',
  'orlando, fl': '32801', 'orlando, florida': '32801',
  'tampa, fl': '33601', 'tampa, florida': '33601',
  'portland, or': '97201', 'portland, oregon': '97201',
  'charlotte, nc': '28201', 'charlotte, north carolina': '28201',
  'minneapolis, mn': '55401', 'detroit, mi': '48201',
  'san antonio, texas': '78201', 'jacksonville, fl': '32099',
  'fort lauderdale, fl': '33301', 'west palm beach, fl': '33401',
  'boca raton, fl': '33428', 'pompano beach, fl': '33060',
  'hollywood, fl': '33019', 'homestead, fl': '33030',
  'aventura, fl': '33160', 'miami gardens, fl': '33056',
  'richmond, va': '23219', 'raleigh, nc': '27601',
  'sacramento, ca': '95814', 'kansas city, mo': '64101',
  'cleveland, oh': '44101', 'pittsburgh, pa': '15219',
  'st. louis, mo': '63101', 'columbus, oh': '43215',
  'indianapolis, in': '46201', 'memphis, tn': '38103',
  'louisville, ky': '40202', 'oklahoma city, ok': '73102'
};

/**
 * Geocode a list of jobs - fills in lat/lng/zip for those missing it
 */
export async function geocodeJobs(jobs) {
  const geocoded = [];
  let apiCallCount = 0;
  let cacheHitCount = 0;
  let lookupCount = 0;
  let skippedCount = 0;

  for (const job of jobs) {
    // Already has zip and lat/lng - skip
    if (job.zip && job.lat && job.lng) {
      geocoded.push(job);
      continue;
    }

    // Already has zip but no lat/lng - look up from zip
    if (job.zip && job.zip.length === 5) {
      const coords = await getCoordsByZip(job.zip);
      if (coords) {
        job.lat = coords.lat;
        job.lng = coords.lng;
      }
      geocoded.push(job);
      continue;
    }

    // Has city and state - try lookup table first
    const cityStateKey = `${job.city}, ${job.state}`.toLowerCase().trim();
    if (CITY_ZIP_LOOKUP[cityStateKey]) {
      job.zip = CITY_ZIP_LOOKUP[cityStateKey];
      const coords = await getCoordsByZip(job.zip);
      if (coords) {
        job.lat = coords.lat;
        job.lng = coords.lng;
      }
      geocoded.push(job);
      lookupCount++;
      continue;
    }

    // Try Census geocoder for unknown locations
    const locationQuery = [job.city, job.state].filter(Boolean).join(', ');
    if (locationQuery.length < 3) {
      // Skip jobs with no usable location (e.g. remote-only)
      geocoded.push(job);
      skippedCount++;
      continue;
    }

    if (geocodeCache.has(locationQuery)) {
      const cached = geocodeCache.get(locationQuery);
      job.zip = cached.zip;
      job.lat = cached.lat;
      job.lng = cached.lng;
      geocoded.push(job);
      cacheHitCount++;
      continue;
    }

    // Rate-limit geocoding calls - max 1 per 100ms
    try {
      const result = await geocodeAddress(locationQuery);
      if (result) {
        job.zip = result.zip || job.zip;
        job.lat = result.lat;
        job.lng = result.lng;
        geocodeCache.set(locationQuery, result);
        apiCallCount++;
      }
      await sleep(100);
    } catch (err) {
      // Geocoding failed - job still added without coords
    }

    geocoded.push(job);
  }

  console.log(`    Geocoding: ${apiCallCount} API calls, ${cacheHitCount} cache hits, ${lookupCount} lookup table, ${skippedCount} skipped`);
  return geocoded;
}

async function geocodeAddress(address) {
  const params = new URLSearchParams({
    address: address,
    benchmark: 'Public_AR_Current',
    format: 'json'
  });

  const res = await fetch(`${CENSUS_GEOCODER}?${params}`, { timeout: 8000 });
  if (!res.ok) return null;

  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];
  if (!match) return null;

  return {
    lat: match.coordinates?.y || null,
    lng: match.coordinates?.x || null,
    zip: match.addressComponents?.zip || ''
  };
}

// Simple zip-to-lat/lng lookup using a free service
const zipCoordCache = new Map();

async function getCoordsByZip(zip) {
  if (zipCoordCache.has(zip)) return zipCoordCache.get(zip);

  // Use zippopotam.us - free, no auth required
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, { timeout: 5000 });
    if (!res.ok) return null;
    const data = await res.json();
    const place = data.places?.[0];
    if (!place) return null;
    const result = { lat: parseFloat(place.latitude), lng: parseFloat(place.longitude) };
    zipCoordCache.set(zip, result);
    return result;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
