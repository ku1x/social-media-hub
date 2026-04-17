#!/usr/bin/env node
/**
 * Extract Instagram sessionid from Chrome CDP and feed to clinstagram.
 * 
 * This bridges our browser-based keepalive with clinstagram's API approach.
 * 
 * Usage:
 *   node ig-cookie-bridge.js                    # Extract and save session
 *   node ig-cookie-bridge.js --check             # Check if session is valid
 *   node ig-cookie-bridge.js --test-reel video.mp4 --caption "test"  # Test post reel
 */

const WebSocket = require('ws');
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const VENV_PYTHON = '/home/node/.local/share/uv/tools/clinstagram/bin/python3';
const CLINSTAGRAM = '/home/node/.local/bin/clinstagram';
const SESSION_FILE = path.join(process.env.HOME || '/home/node', '.openclaw', 'data', 'clinstagram', 'session.json');

// ─── CDP Helper ───────────────────────────────────────────────
async function getCDP() {
  const pages = await new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  const page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No browser tab available');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const handlers = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && handlers.has(msg.id)) {
      handlers.get(msg.id)(msg);
      handlers.delete(msg.id);
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
    handlers.set(msgId, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`));
      else resolve(msg.result);
    });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  return { send, close: () => ws.close() };
}

// ─── Extract Instagram cookies from Chrome ────────────────────
async function extractInstagramCookies() {
  const cdp = await getCDP();

  // Get all cookies for instagram.com
  const { cookies } = await cdp.send('Network.getAllCookies');
  const igCookies = cookies.filter(c => c.domain.includes('instagram.com'));

  const sessionid = igCookies.find(c => c.name === 'sessionid');
  const dsUserId = igCookies.find(c => c.name === 'ds_user_id');
  const csrftoken = igCookies.find(c => c.name === 'csrftoken');

  cdp.close();

  if (!sessionid) {
    throw new Error('No sessionid cookie found. Is Instagram logged in?');
  }

  return {
    sessionid: sessionid.value,
    ds_user_id: dsUserId?.value || '',
    csrftoken: csrftoken?.value || '',
    allCookies: igCookies.map(c => ({ name: c.name, value: c.value, domain: c.domain }))
  };
}

// ─── Save session to clinstagram via instagrapi ───────────────
async function saveSession(sessionId, dsUserId) {
  // Ensure directory exists
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });

  // Use Python to login_by_sessionid and save the full session
  const script = `
import json
import sys
from instagrapi import Client

sessionid = sys.argv[1]
ds_user_id = sys.argv[2]
output_file = sys.argv[3]

cl = Client()
try:
    result = cl.login_by_sessionid(sessionid)
    if result:
        settings = cl.get_settings()
        with open(output_file, 'w') as f:
            json.dump(settings, f)
        # Also get username
        try:
            info = cl.account_info()
            print(json.dumps({"success": True, "username": info.username, "user_id": str(info.pk)}))
        except:
            print(json.dumps({"success": True, "username": "unknown", "user_id": ds_user_id}))
    else:
        print(json.dumps({"success": False, "error": "login_by_sessionid returned False"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

  const scriptFile = '/tmp/ig-login-by-session.py';
  fs.writeFileSync(scriptFile, script);

  try {
    const output = execSync(
      `${VENV_PYTHON} ${scriptFile} "${sessionId}" "${dsUserId}" "${SESSION_FILE}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    return JSON.parse(output.trim());
  } catch (err) {
    throw new Error(`Failed to save session: ${err.message}`);
  }
}

// ─── Check if existing session is valid ───────────────────────
function checkSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    return { valid: false, error: 'No session file found' };
  }

  const script = `
import json
import sys
session_file = sys.argv[1]
from instagrapi import Client
cl = Client()
try:
    with open(session_file) as f:
        settings = json.load(f)
    cl.set_settings(settings)
    info = cl.account_info()
    print(json.dumps({"valid": True, "username": info.username, "user_id": str(info.pk)}))
except Exception as e:
    print(json.dumps({"valid": False, "error": str(e)}))
`;

  const scriptFile = '/tmp/ig-check-session.py';
  fs.writeFileSync(scriptFile, script);

  try {
    const output = execSync(
      `${VENV_PYTHON} ${scriptFile} "${SESSION_FILE}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    return JSON.parse(output.trim());
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ─── Test post reel ───────────────────────────────────────────
function testPostReel(videoPath, caption) {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error('No session file. Run without args first to extract cookies.');
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }

  const script = `
import json
import sys
import os
os.environ["TQDM_DISABLE"] = "1"
session_file = sys.argv[1]
video_path = sys.argv[2]
caption = sys.argv[3]
from instagrapi import Client
cl = Client()
try:
    with open(session_file) as f:
        settings = json.load(f)
    cl.set_settings(settings)
    cl.account_info()
    result = cl.clip_upload(video_path, caption=caption)
    print(json.dumps({"success": True, "media_id": str(result.pk), "code": result.code, "product_type": getattr(result, 'product_type', None)}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

  const scriptFile = '/tmp/ig-post-reel.py';
  fs.writeFileSync(scriptFile, script);

  try {
    const output = execSync(
      `${VENV_PYTHON} ${scriptFile} "${SESSION_FILE}" "${videoPath}" "${caption}"`,
      { encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // Parse last line of output (skip progress lines)
    const lines = output.trim().split('\n');
    const jsonLine = lines.find(l => l.trim().startsWith('{')) || lines[lines.length - 1];
    return JSON.parse(jsonLine);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── CLI ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--check')) {
    console.log('Checking existing session...');
    const result = checkSession();
    if (result.valid) {
      console.log(`✅ Session valid: @${result.username} (ID: ${result.user_id})`);
    } else {
      console.log(`❌ Session invalid: ${result.error}`);
    }
    process.exit(result.valid ? 0 : 1);
  }

  if (args.includes('--test-reel')) {
    const reelIdx = args.indexOf('--test-reel');
    const videoPath = args[reelIdx + 1];
    const captionIdx = args.indexOf('--caption');
    const caption = captionIdx >= 0 ? args[captionIdx + 1] : 'test';
    console.log(`Posting reel: ${videoPath}...`);
    const result = testPostReel(videoPath, caption);
    if (result.success) {
      console.log(`✅ Reel posted! ID: ${result.media_id}, code: ${result.code}`);
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
    process.exit(result.success ? 0 : 1);
  }

  // Default: extract cookies and save session
  console.log('[1/3] Extracting Instagram cookies from Chrome CDP...');
  const cookies = await extractInstagramCookies();
  console.log(`      Found sessionid (${cookies.sessionid.substring(0, 10)}...)`);
  console.log(`      ds_user_id: ${cookies.ds_user_id}`);
  console.log(`      csrftoken: ${cookies.csrftoken.substring(0, 10)}...`);
  console.log(`      Total cookies: ${cookies.allCookies.length}`);

  console.log('[2/3] Logging in via sessionid...');
  const result = await saveSession(cookies.sessionid, cookies.ds_user_id);
  if (!result.success) {
    console.log(`❌ Login failed: ${result.error}`);
    process.exit(1);
  }
  console.log(`      ✅ Logged in as @${result.username} (ID: ${result.user_id})`);

  console.log('[3/3] Session saved to:', SESSION_FILE);
  console.log('\n✅ Cookie bridge complete! clinstagram can now use this session.');
}

main().catch(err => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
