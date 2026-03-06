# Help Wanted — Setup Guide

Complete instructions for getting the database and cron job running.
Total time: ~20 minutes. Total cost: $0/month.

---

## Step 1: Get Free API Keys (10 minutes)

### USAJobs (Government Jobs)
1. Go to https://developer.usajobs.gov/APIRequest/Index
2. Fill in your name and email
3. You'll receive a key by email within minutes
4. Save it — you'll use it in Step 3

### Adzuna (Aggregated Jobs — 250 calls/day free)
1. Go to https://developer.adzuna.com/signup
2. Create a free account
3. Go to Dashboard → My Apps → Create App
4. Copy your **App ID** and **App Key**

---

## Step 2: Set Up Cloudflare (10 minutes)

### Create Cloudflare account
1. Go to https://cloudflare.com and sign up (free)
2. No domain or credit card needed for Workers

### Create KV Namespace
1. In Cloudflare dashboard, go to **Workers & Pages** → **KV**
2. Click **Create namespace**
3. Name it: `HELPWANTED_JOBS`
4. Copy the **Namespace ID** (you'll need this)

### Deploy the Worker
1. Go to **Workers & Pages** → **Create application** → **Create Worker**
2. Name it: `helpwanted-api`
3. Click **Deploy** (ignore the default code for now)
4. Click **Edit code**
5. Delete everything and paste the contents of `worker/worker.js` from this repo
6. Click **Deploy**

### Bind KV to Worker
1. On your Worker's page, go to **Settings** → **Variables**
2. Under **KV Namespace Bindings**, click **Add binding**
3. Variable name: `JOBS_KV`
4. KV namespace: select `HELPWANTED_JOBS`
5. Click **Save and deploy**

### Get your Cloudflare credentials
- **Account ID**: Found in the right sidebar of your Cloudflare dashboard
- **API Token**: Go to **My Profile** → **API Tokens** → **Create Token**
  - Use the "Edit Cloudflare Workers" template
  - Copy the token immediately (it's shown only once)
- **KV Namespace ID**: The ID you copied when creating the namespace

---

## Step 3: Add Secrets to GitHub (5 minutes)

1. Go to your repo: https://github.com/brokercaplan/helpwanted
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** for each of these:

| Secret Name | Where to get it |
|-------------|----------------|
| CLOUDFLARE_ACCOUNT_ID | Cloudflare dashboard right sidebar |
| CLOUDFLARE_API_TOKEN | Created in Step 2 |
| CLOUDFLARE_KV_NAMESPACE_ID | KV namespace ID from Step 2 |
| USAJOBS_API_KEY | Email from Step 1 |
| USAJOBS_EMAIL | The email you used to register |
| ADZUNA_APP_ID | Adzuna dashboard from Step 1 |
| ADZUNA_APP_KEY | Adzuna dashboard from Step 1 |

---

## Step 4: Run the First Ingestion

1. Go to your repo → **Actions** tab
2. You'll see **Daily Job Ingestion** workflow
3. Click it → **Run workflow** → **Run workflow**
4. Watch the logs — it should take 5-15 minutes
5. When complete, you'll see a summary like:
   ```
   Greenhouse: 847 jobs
   Lever: 312 jobs
   USAJobs: 450 jobs
   Adzuna: 980 jobs
   RemoteOK: 187 jobs
   Total: 2,776 unique jobs across 341 zip codes
   ```

After this runs, your Cloudflare KV database is populated and the Worker can serve job searches instantly.

---

## Step 5: Test Your API

Open in a browser:
- `https://helpwanted-api.YOUR-SUBDOMAIN.workers.dev/api/health`
- `https://helpwanted-api.YOUR-SUBDOMAIN.workers.dev/api/meta`
- `https://helpwanted-api.YOUR-SUBDOMAIN.workers.dev/api/jobs?zip=33139`

You should see real job data come back as JSON.

---

## Step 6: Connect the Frontend

In the frontend app (site/ folder), update the Worker URL in the settings:
- Open `site/js/api.js`
- Find the line: `const WORKER_URL = 'YOUR_WORKER_URL'`
- Replace with your actual worker URL

---

## Daily Schedule

The ingestion runs automatically every day at **3 AM UTC** (11 PM EST).
- GitHub Actions triggers the script
- Data is refreshed from all sources
- Cloudflare KV is updated
- Old entries expire automatically after 25 hours

You can monitor runs in: **Actions** → **Daily Job Ingestion** → view run history

---

## Troubleshooting

**Action fails with "missing credentials"**
→ Double-check your GitHub Secrets are spelled exactly as shown

**Greenhouse/Lever returns 0 jobs**
→ Some employer slugs may have changed — this is normal, others will work

**KV write fails**
→ Verify your API Token has "Workers KV Storage: Edit" permission

**Worker returns empty results**
→ Make sure the KV binding variable is named exactly `JOBS_KV`

---

## Cost Summary

| Service | Free Tier | Your Usage |
|---------|-----------|-----------|
| GitHub Actions | 2,000 min/month | ~15 min/day = 450 min/month |
| Cloudflare Workers | 100,000 req/day | Scales with users |
| Cloudflare KV | 100,000 reads/day | 1 read per search |
| Cloudflare KV writes | 1,000 writes/day | ~500 per ingestion |
| USAJobs API | 10,000 req/day | 1 req/day |
| Adzuna API | 250 req/day | 20 req/day |
| Greenhouse API | Unlimited | No limit |
| Lever API | Unlimited | No limit |

**Total monthly cost: $0**
