#!/usr/bin/env node
/**
 * Reddit Text Post Script
 * 
 * Usage:
 *   node reddit-text-post.js --subreddit test --title "Title" --text "Body text"
 *   node reddit-text-post.js --subreddit test --title "Title" --file body.txt
 *   node reddit-text-post.js -s test -t "Title" --text "Body"
 * 
 * Requirements:
 *   - Chrome running with CDP on port 9222
 *   - Reddit logged in (cookie persisted in Chrome profile)
 * 
 * Technical Notes:
 *   - Uses Reddit OAuth API via browser's fetch + Bearer token
 *   - Gets token_v2 cookie via CDP Network.getCookies (httpOnly)
 *   - Text posts use kind=self
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const TIMEOUT = parseInt(process.env.TIMEOUT || '60000', 10);

// ─── CDP Helper ───────────────────────────────────────────────
function createCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const handlers = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && handlers.has(msg.id)) {
      handlers.get(msg.id)(msg);
      handlers.delete(msg.id);
    }
  });

  return {
    ready: new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    }),
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const msgId = id++;
      const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), TIMEOUT);
      handlers.set(msgId, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    }),
    close: () => ws.close(),
  };
}

// ─── Get page from CDP ───────────────────────────────────────
async function getPage() {
  const pages = await new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  let page = pages.find(p => p.url.includes('reddit.com') && p.type === 'page');
  if (!page) page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No browser tab available');
  return page;
}

// ─── Get Reddit auth tokens ──────────────────────────────────
async function getRedditAuth(cdp) {
  const cookieResult = await cdp.send('Network.getCookies', { urls: ['https://www.reddit.com'] });
  const cookies = cookieResult.result.cookies;
  const token = cookies.find(c => c.name === 'token_v2');
  if (!token) throw new Error('Reddit token_v2 not found. Are you logged in?');
  return { accessToken: token.value };
}

// ─── Execute fetch in browser context ────────────────────────
async function browserFetch(cdp, url, options = {}) {
  const fetchCode = `
    (async () => {
      try {
        const resp = await fetch(${JSON.stringify(url)}, ${JSON.stringify(options)});
        const data = await resp.json();
        return JSON.stringify(data);
      } catch(e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `;
  const result = await cdp.send('Runtime.evaluate', {
    expression: fetchCode,
    returnByValue: true,
    awaitPromise: true,
  });
  return JSON.parse(result.result.result.value);
}

// ─── Main: Text Post ─────────────────────────────────────────
async function redditTextPost(subreddit, title, text = '', flairOpts = {}) {
  console.log('[1/4] Connecting to Chrome CDP...');
  const page = await getPage();
  const cdp = createCDP(page.webSocketDebuggerUrl);
  await cdp.ready;

  console.log('[2/4] Getting Reddit auth tokens...');
  const auth = await getRedditAuth(cdp);
  console.log(`      Got token_v2 (${auth.accessToken.length} chars)`);

  console.log('[3/4] Creating text post...');
  const postBody = [
    `api_type=json`,
    `kind=self`,
    `sr=${encodeURIComponent(subreddit)}`,
    `title=${encodeURIComponent(title)}`,
    `text=${encodeURIComponent(text)}`,
  ];

  // Add flair if specified
  if (flairOpts.id) postBody.push(`flair_id=${encodeURIComponent(flairOpts.id)}`);
  if (flairOpts.text) postBody.push(`flair_text=${encodeURIComponent(flairOpts.text)}`);

  const submitResult = await browserFetch(cdp, 'https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postBody.join('&'),
  });

  if (submitResult.json?.errors?.length > 0) {
    const errors = submitResult.json.errors.map(e => e.join(': ')).join(', ');
    throw new Error(`Reddit API errors: ${errors}`);
  }

  const postData = submitResult.json?.data;
  if (!postData?.url) {
    throw new Error(`Unexpected response: ${JSON.stringify(submitResult).substring(0, 300)}`);
  }

  console.log('[4/4] Done!');
  console.log(`      URL: ${postData.url}`);
  console.log(`      ID: ${postData.id}`);

  cdp.close();

  console.log('\n✅ Text post published!');
  return { success: true, url: postData.url, id: postData.id };
}

// ─── CLI ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  node reddit-text-post.js --subreddit test --title "Title" --text "Body"');
    console.error('  node reddit-text-post.js -s test -t "Title" --text "Body"');
    console.error('  node reddit-text-post.js -s test -t "Title" --file body.txt');
    process.exit(1);
  }

  let subreddit = '', title = '', text = '', filePath = '', flairId = '', flairText = '';
  const cliArgs = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--subreddit': case '-s': subreddit = args[++i]; break;
      case '--title': case '-t': title = args[++i]; break;
      case '--text': text = args[++i]; break;
      case '--file': case '-f': filePath = args[++i]; break;
      case '--flair-id': flairId = args[++i]; cliArgs['--flair-id'] = flairId; break;
      case '--flair-text': flairText = args[++i]; cliArgs['--flair-text'] = flairText; break;
    }
  }

  if (filePath) {
    if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }
    text = fs.readFileSync(filePath, 'utf-8').trim();
  }
  if (!subreddit) { console.error('Error: --subreddit is required'); process.exit(1); }
  if (!title) { console.error('Error: --title is required'); process.exit(1); }

  console.log(`r/${subreddit} | "${title}" | ${text.length} chars`);
  console.log('');

  try {
    const result = await redditTextPost(subreddit, title, text, { id: flairId, text: flairText });
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
