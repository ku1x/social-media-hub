#!/usr/bin/env node
// linkedin-job-search.js — 使用 LinkedIn Voyager API 搜索岗位
// 用法: node linkedin-job-search.js --keywords "AIGC" --location "Germany" --limit 25

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const CONFIG_PATH = path.join(HOME, '.linkedin-cli', 'config.json');

// Parse args
const args = process.argv.slice(2);
let keywords = '';
let location = '';
let limit = 10;
let start = 0;
let postedWithin = 'r2592000'; // default: 30 days
let experience = '';
let remote = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--keywords' && args[i + 1]) keywords = args[++i];
  else if (args[i] === '--location' && args[i + 1]) location = args[++i];
  else if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i]);
  else if (args[i] === '--start' && args[i + 1]) start = parseInt(args[++i]);
  else if (args[i] === '--posted-within' && args[i + 1]) postedWithin = args[++i];
  else if (args[i] === '--experience' && args[i + 1]) experience = args[++i];
  else if (args[i] === '--remote') remote = true;
}

if (!keywords) {
  console.error('Usage: linkedin-job-search --keywords "AIGC" --location "Germany" [--limit 25] [--posted-within r2592000]');
  process.exit(1);
}

// Load config
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (e) {
  console.error('Error: Cannot read config at', CONFIG_PATH);
  process.exit(1);
}

const { li_at, jsessionid } = config;
if (!li_at || !jsessionid) {
  console.error('Error: Missing li_at or jsessionid in config');
  process.exit(1);
}

// Build filters
let filtersStr = '';
if (postedWithin) filtersStr += `,timeFilterRange:${postedWithin}`;
if (experience) filtersStr += `,experience:${experience}`;
if (remote) filtersStr += `,workplaceType:2`;

const locationStr = location ? `,locationFallback:${encodeURIComponent(location)}` : '';

const apiUrl = `https://www.linkedin.com/voyager/api/voyagerJobsDashJobCards?decorationId=com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-174&count=${limit}&q=jobSearch&query=(origin:JOB_SEARCH_PAGE_QUERY_EXPANSION,keywords:${encodeURIComponent(keywords)}${locationStr}${filtersStr},spellCorrectionEnabled:true)&start=${start}`;

async function search() {
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        'Cookie': `li_at=${li_at}; JSESSIONID="${jsessionid}"`,
        'Csrf-Token': jsessionid,
        'Accept': 'application/vnd.linkedin.normalized+json+2.1',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'x-li-lang': 'en_US',
        'x-li-track': '{"clientVersion":"1.13.0"}',
        'x-restli-protocol-version': '2.0.0',
      }
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`API Error ${resp.status}: ${text.substring(0, 300)}`);
      process.exit(1);
    }

    const data = await resp.json();
    const results = [];

    // Parse the normalized response
    const included = data.included || [];
    const elements = data.data?.elements || [];

    // Build a lookup for included entities
    const entityMap = {};
    for (const item of included) {
      if (item.entityUrn) {
        entityMap[item.entityUrn] = item;
      }
      // Also index by $*ref
      for (const key of Object.keys(item)) {
        if (item[key] && typeof item[key] === 'object' && item[key]['*ref']) {
          // skip
        }
      }
    }

    // Also index by dsi (data source id)
    const dsiMap = {};
    for (const item of included) {
      if (item.dsi) {
        dsiMap[item.dsi] = item;
      }
    }

    // Extract jobs from elements
    for (const element of elements) {
      const jobCard = element;
      const jobUrn = jobCard.jobCardUrn || jobCard.entityUrn || '';
      const dsi = jobCard.dsi || '';

      // Find the job posting in included
      let job = null;
      let company = null;

      // Try to find via dsi
      if (dsi && dsiMap[dsi]) {
        job = dsiMap[dsi];
      }

      // Try to find via *jobPosting ref
      const jobPostingRef = jobCard['*jobPosting'];
      if (jobPostingRef && entityMap[jobPostingRef]) {
        job = entityMap[jobPostingRef];
      }

      // Try to find in included by matching urn
      if (!job) {
        for (const item of included) {
          if (item.entityUrn && item.entityUrn.includes('jobPosting')) {
            job = item;
            break;
          }
        }
      }

      // Extract from jobCard directly
      const title = jobCard.jobPosting?.title || job?.title || jobCard.title || '';
      const companyName = jobCard.jobPosting?.companyName || job?.companyName || jobCard.companyName || '';
      const locationText = jobCard.jobPosting?.location || job?.location || jobCard.location || '';
      const listedAt = jobCard.jobPosting?.listedAt || job?.listedAt || jobCard.listedAt || 0;
      const applyUrl = jobCard.jobPosting?.applyUrl || job?.applyUrl || '';

      // Build job URL from urn
      const jobId = jobUrn.replace('urn:li:fsd_jobCard:', '').replace('urn:li:fs_jobPosting:', '');
      const jobUrl = jobId ? `https://www.linkedin.com/jobs/view/${jobId}` : '';

      if (title || companyName) {
        results.push({
          title,
          company: companyName,
          location: locationText,
          listedAt,
          jobUrl,
          applyUrl,
          urn: jobUrn
        });
      }
    }

    // If no results from structured parsing, try raw extraction
    if (results.length === 0) {
      // Dump raw for debugging
      const rawJobs = [];
      for (const item of included) {
        if (item.title && item.companyName) {
          rawJobs.push({
            title: item.title,
            company: item.companyName,
            location: item.location || '',
            listedAt: item.listedAt || 0,
            jobUrl: item.entityUrn ? `https://www.linkedin.com/jobs/view/${item.entityUrn.split(':').pop()}` : '',
            urn: item.entityUrn || ''
          });
        }
      }
      if (rawJobs.length > 0) {
        console.log(JSON.stringify(rawJobs, null, 2));
        return;
      }

      // Last resort: dump the structure
      console.error('No structured results found. Dumping element keys:');
      for (const element of elements.slice(0, 2)) {
        console.error('Element keys:', Object.keys(element));
      }
      console.error('Included sample (first 3):');
      for (const item of included.slice(0, 3)) {
        console.error(JSON.stringify(item).substring(0, 200));
      }
      process.exit(1);
    }

    console.log(JSON.stringify(results, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

search();
