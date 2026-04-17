#!/usr/bin/env node
// tiktok-post.js — Upload video to TikTok via TiktokAutoUploader API
// Usage: node tiktok-post.js -v video.mp4 -t "Title #hashtags"
//        node tiktok-post.js -v video.mp4 -t "Title" -sc 3600  (schedule 1hr later)

const { WebSocket } = require('ws');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const UPLOADER_DIR = path.join(HOME, '.openclaw/tools/TiktokAutoUploader');
const VIDEO_DIR = path.join(UPLOADER_DIR, 'VideosDirPath');
const VENV_PYTHON = path.join(UPLOADER_DIR, '.venv/bin/python');
const CLI_SCRIPT = path.join(UPLOADER_DIR, 'cli.py');

// ─── Parse Args ─────────────────────────────────────────────
const args = process.argv.slice(2);
let videoPath = '';
let title = '';
let schedule = 0;
let visibility = 0;
let allowComment = 1;
let allowDuet = 0;
let allowStitch = 0;
let username = 'acg_ai';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-v': case '--video': videoPath = args[++i]; break;
    case '-t': case '--title': title = args[++i]; break;
    case '-sc': case '--schedule': schedule = parseInt(args[++i]); break;
    case '-vi': case '--visibility': visibility = parseInt(args[++i]); break;
    case '-u': case '--user': username = args[++i]; break;
    case '-ct': case '--comment': allowComment = parseInt(args[++i]); break;
    case '-d': case '--duet': allowDuet = parseInt(args[++i]); break;
    case '-st': case '--stitch': allowStitch = parseInt(args[++i]); break;
  }
}

if (!videoPath || !title) {
  console.error('Usage: node tiktok-post.js -v <video.mp4> -t "Title" [-u username] [-sc seconds] [-vi 0|1]');
  console.error('');
  console.error('Options:');
  console.error('  -v, --video      Video file path (required)');
  console.error('  -t, --title      Video title with hashtags (required)');
  console.error('  -u, --user       TikTok username (default: acg_ai)');
  console.error('  -sc, --schedule  Schedule in seconds from now (0 = immediate)');
  console.error('  -vi, --visibility 0=public (default), 1=private');
  console.error('  -ct, --comment   Allow comments 0|1 (default: 1)');
  console.error('  -d,  --duet      Allow duet 0|1 (default: 0)');
  console.error('  -st, --stitch    Allow stitch 0|1 (default: 0)');
  process.exit(1);
}

// ─── Step 1: Refresh cookies from Chrome CDP ────────────────
async function refreshCookies() {
  console.log('[1/3] Refreshing TikTok cookies from Chrome...');

  const resp = await fetch('http://localhost:9222/json');
  const targets = await resp.json();
  const page = targets.find(t => t.type === 'page') || targets[0];
  if (!page) throw new Error('No Chrome page target found');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  // Enable Network
  await new Promise((resolve) => {
    ws.send(JSON.stringify({ id: 0, method: 'Network.enable' }));
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === 0) { ws.off('message', handler); resolve(); }
    };
    ws.on('message', handler);
  });

  // Get cookies
  const result = await new Promise((resolve, reject) => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Network.getCookies',
      params: { urls: ['https://www.tiktok.com'] }
    }));
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === 1) { ws.off('message', handler); resolve(msg.result); }
    };
    ws.on('message', handler);
    setTimeout(() => reject(new Error('CDP timeout')), 10000);
  });

  ws.close();

  const cookies = result.cookies || [];
  const needed = ['sessionid', 'sid_tt', 'ttwid', 'odin_tt', 'tt-target-idc'];
  const found = {};
  for (const c of cookies) {
    if (needed.includes(c.name)) found[c.name] = c.value;
  }

  if (!found.sessionid) {
    throw new Error(`Missing sessionid cookie. Found: ${Object.keys(found).join(', ')}`);
  }

  console.log(`   Found cookies: ${Object.keys(found).join(', ')}`);

  // Write cookies as JSON, then convert to pickle via Python script file
  const tmpJson = '/tmp/tiktok-cookies-fresh.json';
  fs.writeFileSync(tmpJson, JSON.stringify(found, null, 2));

  const tmpPy = '/tmp/tiktok-write-cookie.py';
  fs.writeFileSync(tmpPy, `
import pickle, json, os
with open("/tmp/tiktok-cookies-fresh.json") as f:
    fresh = json.load(f)
cookies = []
for name, http_only in [("sessionid", True), ("sid_tt", False), ("ttwid", False), ("odin_tt", False), ("tt-target-idc", False)]:
    if name in fresh:
        cookies.append({"name": name, "value": fresh[name], "domain": ".tiktok.com", "path": "/", "secure": True, "httpOnly": http_only})
cookie_file = os.path.expanduser("~/.openclaw/tools/TiktokAutoUploader/CookiesDir/tiktok_session-${username}.cookie")
with open(cookie_file, "wb") as f:
    pickle.dump(cookies, f)
print("OK")
`);

  const pyResult = execSync(`${VENV_PYTHON} ${tmpPy}`, { encoding: 'utf-8' });
  if (pyResult.trim() !== 'OK') throw new Error('Failed to write pickle cookie file');
  console.log('   Cookie file updated ✓');
}

// ─── Step 2: Copy video to VideosDirPath ────────────────────
function prepareVideo() {
  console.log('[2/3] Preparing video...');

  const absVideoPath = path.resolve(videoPath);
  if (!fs.existsSync(absVideoPath)) {
    throw new Error(`Video not found: ${absVideoPath}`);
  }

  const videoName = path.basename(absVideoPath);
  const destPath = path.join(VIDEO_DIR, videoName);

  if (absVideoPath !== destPath) {
    fs.copyFileSync(absVideoPath, destPath);
    console.log(`   Copied to: ${destPath}`);
  } else {
    console.log(`   Already in VideosDir: ${videoName}`);
  }

  return videoName;
}

// ─── Step 3: Upload via TiktokAutoUploader CLI ──────────────
function uploadVideo(videoName) {
  console.log('[3/3] Uploading to TikTok...');

  let cmd = `cd ${UPLOADER_DIR} && ${VENV_PYTHON} ${CLI_SCRIPT} upload -u ${username} -v ${videoName} -t ${JSON.stringify(title)}`;
  if (schedule > 0) cmd += ` -sc ${schedule}`;
  if (visibility > 0) cmd += ` -vi ${visibility}`;
  if (allowComment === 0) cmd += ` -ct 0`;
  if (allowDuet === 1) cmd += ` -d 1`;
  if (allowStitch === 1) cmd += ` -st 1`;

  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 120000 });
    console.log(output.trim());

    if (output.includes('Published successfully')) {
      console.log('\n✅ Video published successfully!');
    } else if (output.includes('Schedule')) {
      console.log('\n✅ Video scheduled successfully!');
    } else {
      console.log('\n⚠️ Upload completed but status unclear.');
    }
  } catch (err) {
    console.error('\n❌ Upload failed:');
    console.error(err.stdout || err.message);
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  try {
    await refreshCookies();
    const videoName = prepareVideo();
    uploadVideo(videoName);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
