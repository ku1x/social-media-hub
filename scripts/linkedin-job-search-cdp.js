#!/usr/bin/env node
// linkedin-job-search-cdp.js — 通过 Chrome CDP 在 LinkedIn 页面内搜索岗位
// 用法: node linkedin-job-search-cdp.js --keywords "AIGC" --location "Germany" --limit 25

const { WebSocket } = require('ws');

const args = process.argv.slice(2);
let keywords = '';
let location = '';
let limit = 25;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--keywords' && args[i + 1]) keywords = args[++i];
  else if (args[i] === '--location' && args[i + 1]) location = args[++i];
  else if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i]);
}

if (!keywords) {
  console.error('Usage: linkedin-job-search-cdp --keywords "AIGC" --location "Germany" [--limit 25]');
  process.exit(1);
}

async function search() {
  const resp = await fetch('http://localhost:9222/json');
  const targets = await resp.json();
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let cmdId = 1;
  const send = (method, params = {}) => {
    const id = cmdId++;
    return new Promise((resolve, reject) => {
      ws.send(JSON.stringify({ id, method, params }));
      const handler = (data) => {
        const msg = JSON.parse(data);
        if (msg.id === id) { ws.off('message', handler); resolve(msg.result || msg); }
      };
      ws.on('message', handler);
      setTimeout(() => reject(new Error(`Timeout: ${method}`)), 60000);
    });
  };

  // Navigate to LinkedIn jobs search
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_TPR=r2592000&position=1&pageNum=0`;
  console.error(`Navigating to: ${searchUrl}`);
  
  await send('Page.enable');
  await send('Page.navigate', { url: searchUrl });
  
  // Wait for page load
  await new Promise(r => setTimeout(r, 6000));

  // Check if we got redirected to login
  const urlResult = await send('Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true
  });
  const currentUrl = urlResult.result?.value || '';
  console.error(`Current URL: ${currentUrl}`);
  
  if (currentUrl.includes('/login') || currentUrl.includes('/uas/login')) {
    console.error('ERROR: Redirected to login page. Session expired.');
    ws.close();
    process.exit(1);
  }

  // Scroll down to load more results
  for (let i = 0; i < Math.ceil(limit / 25); i++) {
    await send('Runtime.evaluate', {
      expression: 'window.scrollBy(0, 3000)',
      returnByValue: true
    });
    await new Promise(r => setTimeout(r, 2000));
  }

  // Extract job data
  const extractResult = await send('Runtime.evaluate', {
    expression: `
      (function() {
        const jobs = [];
        // Try multiple selectors for LinkedIn job cards
        const selectors = [
          '.jobs-search__results-list .job-search-card',
          '.jobs-search__results-list li',
          '.job-search-card',
          '[data-entity-urn*="jobPosting"]',
          '.base-card'
        ];
        
        let cards = [];
        for (const sel of selectors) {
          const found = document.querySelectorAll(sel);
          if (found.length > cards.length) cards = found;
        }
        
        cards.forEach(card => {
          const titleEl = card.querySelector('.base-search-card__title, h3, .job-search-card__title, .base-card__title');
          const companyEl = card.querySelector('.base-search-card__subtitle, h4, .job-search-card__subtitle, .base-card__subtitle');
          const locationEl = card.querySelector('.job-search-card__location, .base-search-card__metadata');
          const linkEl = card.querySelector('a.base-card__full-link, a[href*="/jobs/view/"], a[href*="/jobs/"]');
          const dateEl = card.querySelector('time');
          
          const title = titleEl ? titleEl.textContent.trim() : '';
          const company = companyEl ? companyEl.textContent.trim() : '';
          const loc = locationEl ? locationEl.textContent.trim() : '';
          const url = linkEl ? linkEl.href : '';
          const date = dateEl ? dateEl.getAttribute('datetime') || dateEl.textContent.trim() : '';
          
          if (title) {
            jobs.push({ title, company, location: loc, url, date });
          }
        });
        return JSON.stringify(jobs);
      })()
    `,
    returnByValue: true
  });

  ws.close();

  let jobs = [];
  try {
    const resultText = extractResult.result?.value || '[]';
    jobs = JSON.parse(resultText);
  } catch (e) {
    console.error('Parse error:', e.message);
  }

  jobs = jobs.slice(0, limit);
  console.log(JSON.stringify(jobs, null, 2));
  console.error(`Found ${jobs.length} jobs for "${keywords}" in "${location}"`);
}

search().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
