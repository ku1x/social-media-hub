#!/usr/bin/env node
/**
 * Reddit Image Post Script
 * 
 * Usage:
 *   node reddit-image-post.js --subreddit test --title "Title" --images img1.png
 *   node reddit-image-post.js -s test -t "Title" --images img1.png img2.jpg
 *   node reddit-image-post.js -s test -t "Title" --text "Body" --images img1.png
 * 
 * Requirements:
 *   - Chrome running with CDP on port 9222
 *   - Reddit logged in (cookie persisted in Chrome profile)
 * 
 * Technical Notes:
 *   - Reddit new UI doesn't expose file input for image upload
 *   - Uses Reddit OAuth API via browser's fetch + Bearer token
 *   - Upload flow: get S3 lease → upload to S3 → submit with raw S3 URL
 *   - CRITICAL: Must use raw S3 URL (not i.redd.it) — CDN hasn't propagated yet
 *   - Gets token_v2 cookie via CDP Network.getCookies (httpOnly)
 */

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// ─── Upload image to Reddit S3 ───────────────────────────────
async function uploadImage(cdp, imagePath, auth) {
  const absolutePath = path.resolve(imagePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Image file not found: ${absolutePath}`);

  const fileBuffer = fs.readFileSync(absolutePath);
  const fileExt = path.extname(absolutePath).toLowerCase();
  const mimeType = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp',
  }[fileExt] || 'image/png';

  console.log(`      Uploading ${path.basename(absolutePath)} (${(fileBuffer.length / 1024).toFixed(1)}KB, ${mimeType})`);

  // Step 1: Get S3 upload lease
  const leaseUrl = `https://oauth.reddit.com/api/media/asset.json?filepath=${encodeURIComponent(path.basename(absolutePath))}&mimetype=${encodeURIComponent(mimeType)}`;

  const assetResult = await browserFetch(cdp, leaseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (assetResult.error) throw new Error(`Failed to get upload lease: ${assetResult.error}`);

  const asset = assetResult.args || assetResult;
  if (!asset?.action) throw new Error(`Unexpected lease response: ${JSON.stringify(assetResult).substring(0, 200)}`);

  // Step 2: Upload to S3
  let s3Url = asset.action;
  if (s3Url.startsWith('//')) s3Url = 'https:' + s3Url;
  const fields = asset.fields || [];

  const boundary = '----FormBoundary' + crypto.randomBytes(16).toString('hex');
  let formData = '';
  for (const field of fields) {
    formData += `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`;
  }
  formData += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(absolutePath)}"\r\nContent-Type: ${mimeType}\r\n\r\n`;

  const formBuffer = Buffer.concat([
    Buffer.from(formData, 'utf-8'),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
  ]);

  const uploaded = await new Promise((resolve, reject) => {
    const parsedUrl = new URL(s3Url);
    const req = https.request({
      hostname: parsedUrl.hostname, port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formBuffer.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(formBuffer);
    req.end();
  });

  if (uploaded.status < 200 || uploaded.status >= 300) {
    throw new Error(`S3 upload failed (${uploaded.status}): ${uploaded.body.substring(0, 200)}`);
  }

  // Construct raw S3 URL (Reddit needs this, NOT i.redd.it)
  const keyField = fields.find(f => f.name === 'key');
  const mediaKey = keyField ? keyField.value : '';
  const finalS3Url = `${s3Url}/${mediaKey}`;

  console.log(`      Upload complete → ${finalS3Url}`);
  return { mediaKey, s3Url: finalS3Url };
}

// ─── Main: Image Post ────────────────────────────────────────
async function redditImagePost(subreddit, title, text = '', imagePaths = []) {
  if (!imagePaths.length) throw new Error('At least one image required. Use --images.');

  console.log('[1/5] Connecting to Chrome CDP...');
  const page = await getPage();
  const cdp = createCDP(page.webSocketDebuggerUrl);
  await cdp.ready;

  console.log('[2/5] Getting Reddit auth tokens...');
  const auth = await getRedditAuth(cdp);
  console.log(`      Got token_v2 (${auth.accessToken.length} chars)`);

  console.log(`[3/5] Uploading ${imagePaths.length} image(s)...`);
  const mediaAssets = [];
  for (const imgPath of imagePaths) {
    const asset = await uploadImage(cdp, imgPath, auth);
    mediaAssets.push(asset);
  }

  console.log('[4/5] Creating image post...');
  let postBody;

  if (mediaAssets.length === 1) {
    // Single image
    postBody = [
      `api_type=json`, `kind=image`,
      `sr=${encodeURIComponent(subreddit)}`,
      `title=${encodeURIComponent(title)}`,
      `text=${encodeURIComponent(text)}`,
      `url=${encodeURIComponent(mediaAssets[0].s3Url)}`,
      `resubmit=true`,
    ].join('&');
  } else {
    // Gallery (multiple images)
    postBody = [
      `api_type=json`, `kind=image`,
      `sr=${encodeURIComponent(subreddit)}`,
      `title=${encodeURIComponent(title)}`,
      `text=${encodeURIComponent(text)}`,
      `resubmit=true`,
      ...mediaAssets.map((m, i) => `media_metadata[${i}][media_key]=${encodeURIComponent(m.mediaKey)}`),
      ...mediaAssets.map((m, i) => `media_metadata[${i}][caption]=`),
      `gallery_data[layout]=slider`,
      ...mediaAssets.map((m, i) => `gallery_data[items][${i}][media_id]=${encodeURIComponent(m.mediaKey)}`),
      ...mediaAssets.map((m, i) => `gallery_data[items][${i}][caption]=`),
    ].join('&');
  }

  const submitResult = await browserFetch(cdp, 'https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postBody,
  });

  if (submitResult.json?.errors?.length > 0) {
    const errors = submitResult.json.errors.map(e => e.join(': ')).join(', ');
    throw new Error(`Reddit API errors: ${errors}`);
  }

  const postData = submitResult.json?.data;
  if (!postData) throw new Error(`Unexpected response: ${JSON.stringify(submitResult).substring(0, 300)}`);

  // Image posts return user_submitted_page instead of direct URL
  // Fetch the actual post URL from user's recent submissions
  let postUrl = postData.url || '';
  let postId = postData.id || '';

  if (!postUrl && postData.user_submitted_page) {
    // Wait a moment for Reddit to process
    await new Promise(r => setTimeout(r, 3000));
    const userPosts = await browserFetch(cdp, `https://oauth.reddit.com/user/GhostyAi/submitted.json?limit=1`, {
      headers: { 'Authorization': `Bearer ${auth.accessToken}` },
    });
    const recentPost = userPosts?.data?.children?.[0]?.data;
    if (recentPost) {
      postUrl = `https://www.reddit.com${recentPost.permalink}`;
      postId = recentPost.id;
    }
  }

  console.log('[5/5] Done!');
  console.log(`      URL: ${postUrl}`);
  console.log(`      ID: ${postId}`);

  cdp.close();

  console.log('\n✅ Image post published!');
  return { success: true, url: postUrl, id: postId };
}

// ─── CLI ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  node reddit-image-post.js --subreddit test --title "Title" --images img1.png');
    console.error('  node reddit-image-post.js -s test -t "Title" --images img1.png img2.jpg');
    console.error('  node reddit-image-post.js -s test -t "Title" --text "Body" --images img1.png');
    process.exit(1);
  }

  let subreddit = '', title = '', text = '', imagePaths = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--subreddit': case '-s': subreddit = args[++i]; break;
      case '--title': case '-t': title = args[++i]; break;
      case '--text': text = args[++i]; break;
      case '--images': case '-i':
        while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          imagePaths.push(args[++i]);
        }
        break;
    }
  }

  if (!subreddit) { console.error('Error: --subreddit is required'); process.exit(1); }
  if (!title) { console.error('Error: --title is required'); process.exit(1); }
  if (!imagePaths.length) { console.error('Error: --images is required for image posts'); process.exit(1); }

  console.log(`r/${subreddit} | "${title}" | ${imagePaths.length} image(s)`);
  console.log('');

  try {
    const result = await redditImagePost(subreddit, title, text, imagePaths);
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
