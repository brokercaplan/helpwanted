# Help Wanted — Location-Based Job Discovery App

> "We brought back the help wanted sign for the smartphone era."
>
> A location-aware job discovery PWA that shows job openings near you as you move through your city — like a digital help wanted sign that follows you.
>
> ## How It Works
>
> 1. User opens the app (or gets a push notification)
> 2. 2. GPS detects their location
>    3. 3. App queries pre-cached job database by zip code / radius
>       4. 4. Jobs appear as map pins + list sorted by distance
>          5. 5. One tap to view details and apply on the employer's site
>            
>             6. ## Architecture
>            
>             7. ```
>                GitHub Actions (runs once/day)
>                    ↓
>                Ingestion Script (scripts/ingest.js)
>                    ↓  pulls from:
>                    ├── Greenhouse ATS API (free, no key, 200+ employers)
>                    ├── Lever ATS API (free, no key, 100+ employers)
>                    ├── USAJobs API (free, government jobs)
>                    ├── Adzuna API (free tier, 250 req/day — used ONCE daily)
>                    └── RemoteOK API (free, no key)
>                    ↓
>                Geocode by zip code (US Census geocoder, free)
>                    ↓
>                Cloudflare KV (database — free 100K reads/day)
>                    ↓
>                Cloudflare Worker (API — free 100K req/day)
>                    ↓
>                Frontend PWA (site/ folder — hosted on Cloudflare Pages or Netlify)
>                ```
>
> ## Key Design Principle
>
> **API calls happen ONCE per day** via GitHub Actions cron, not on every user search.
> All search queries hit the pre-built Cloudflare KV database — instant results, zero live API calls per user.
>
> ## Repo Structure
>
> ```
> helpwanted/
> ├── site/                    # Frontend PWA
> │   ├── index.html
> │   ├── manifest.json
> │   ├── sw.js
> │   ├── css/
> │   │   └── style.css
> │   └── js/
> │       ├── app.js
> │       └── api.js
> ├── worker/                  # Cloudflare Worker (your backend API)
> │   └── worker.js
> ├── scripts/                 # Data ingestion
> │   ├── ingest.js            # Main ingestion runner
> │   ├── sources/
> │   │   ├── greenhouse.js    # Greenhouse ATS scraper
> │   │   ├── lever.js         # Lever ATS scraper
> │   │   ├── usajobs.js       # USAJobs API
> │   │   ├── adzuna.js        # Adzuna API (1 call/day)
> │   │   └── remotework.js    # RemoteOK API
> │   └── utils/
> │       ├── geocode.js       # Zip code geocoding
> │       └── dedupe.js        # Deduplication logic
> ├── .github/
> │   └── workflows/
> │       └── ingest.yml       # Daily cron job
> ├── employers.json           # Curated employer list for ATS
> └── README.md
> ```
>
> ## Setup
>
> See SETUP.md for full deployment instructions.
>
> ## Data Sources (All Free)
>
> | Source | Type | Daily Limit | Key Required |
> |--------|------|-------------|--------------|
> | Greenhouse ATS | Employer career pages | Unlimited | No |
> | Lever ATS | Employer career pages | Unlimited | No |
> | USAJobs | Government jobs | 10,000/day | Yes (free) |
> | Adzuna | Aggregated jobs | 250/day | Yes (free) |
> | RemoteOK | Remote jobs | ~500/day | No |
>
> ## Cost
>
> **$0/month** — Cloudflare free tier covers all usage at launch scale.
> 
