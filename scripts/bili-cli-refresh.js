#!/usr/bin/env node
// bili-refresh-credential.js — 从 Chrome CDP 提取 B站 Cookie，更新 bili-cli 凭证文件
// 用法: node bili-refresh-credential.js
// 当 bili status 报 "not_authenticated" 或凭证过期时运行此脚本

const { WebSocket } = require('ws');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const CREDENTIAL_PATH = path.join(HOME, '.openclaw/data/bilibili-cli/credential.json');
const BILI_CONFIG_DIR = path.join(HOME, '.bilibili-cli');

// ─── Step 1: Extract cookies from Chrome CDP ────────────────
async function extractCookies() {
  console.log('[1/3] Extracting B站 cookies from Chrome CDP...');

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

  // Get bilibili cookies
  const result = await new Promise((resolve, reject) => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Network.getCookies',
      params: { urls: ['https://www.bilibili.com', 'https://api.bilibili.com'] }
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
  const needed = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'buvid3', 'buvid4'];
  const found = {};
  for (const c of cookies) {
    if (needed.includes(c.name)) found[c.name] = c.value;
  }

  // Validate critical cookies
  if (!found.SESSDATA) throw new Error('Missing SESSDATA cookie - B站未登录');
  if (!found.bili_jct) throw new Error('Missing bili_jct cookie - 无法执行写入操作');
  if (!found.DedeUserID) throw new Error('Missing DedeUserID cookie');

  console.log(`   Found: ${Object.keys(found).join(', ')}`);
  return found;
}

// ─── Step 2: Write credential file ──────────────────────────
function writeCredential(cookies) {
  console.log('[2/3] Writing credential file...');

  // Ensure directory exists
  const dir = path.dirname(CREDENTIAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // bili-cli credential.json format
  const credential = {
    sessdata: cookies.SESSDATA,
    bili_jct: cookies.bili_jct,
    dedeuserid: cookies.DedeUserID,
    dedeuserid__ckmd5: cookies.DedeUserID__ckMd5 || '',
    buvid3: cookies.buvid3 || '',
    buvid4: cookies.buvid4 || '',
  };

  fs.writeFileSync(CREDENTIAL_PATH, JSON.stringify(credential, null, 2));
  console.log(`   Written: ${CREDENTIAL_PATH}`);

  // Ensure symlink exists
  const symlinkPath = path.join(BILI_CONFIG_DIR, 'credential.json');
  if (!fs.existsSync(BILI_CONFIG_DIR)) fs.mkdirSync(BILI_CONFIG_DIR, { recursive: true });

  // Check if symlink already points to the right place
  try {
    const existing = fs.readlinkSync(symlinkPath);
    if (existing !== CREDENTIAL_PATH) {
      fs.unlinkSync(symlinkPath);
      fs.symlinkSync(CREDENTIAL_PATH, symlinkPath);
    }
  } catch {
    // Doesn't exist or not a symlink
    if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    fs.symlinkSync(CREDENTIAL_PATH, symlinkPath);
  }
  console.log(`   Symlink: ${symlinkPath} → ${CREDENTIAL_PATH}`);
}

// ─── Step 3: Validate ───────────────────────────────────────
function validate() {
  console.log('[3/3] Validating credential...');

  const biliBin = path.join(HOME, '.local/bin/bili');
  const biliAlt = path.join(HOME, '.openclaw/tools/bin/bili');
  const bili = fs.existsSync(biliBin) ? biliBin : biliAlt;

  try {
    const output = execSync(`${bili} status --yaml`, {
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env, PATH: `${path.dirname(bili)}:${process.env.PATH}` }
    });

    if (output.includes('authenticated: true')) {
      // Extract user info
      const nameMatch = output.match(/name:\s*(\S+)/);
      const idMatch = output.match(/id:\s*'?(\d+)'?/);
      const levelMatch = output.match(/level:\s*(\d+)/);
      console.log(`   ✅ Authenticated as ${nameMatch?.[1] || 'unknown'} (UID: ${idMatch?.[1] || '?'}, LV${levelMatch?.[1] || '?'})`);
      return true;
    } else {
      console.log('   ❌ Authentication failed');
      console.log(output);
      return false;
    }
  } catch (err) {
    const output = err.stdout || err.message;
    if (output.includes('authenticated: true')) {
      console.log('   ✅ Authenticated (exit code non-zero but credential valid)');
      return true;
    }
    console.log('   ❌ Validation failed:', output);
    return false;
  }
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  try {
    const cookies = await extractCookies();
    writeCredential(cookies);
    const valid = validate();

    if (valid) {
      console.log('\n✅ B站凭证刷新成功！');
    } else {
      console.log('\n⚠️ 凭证已写入但验证失败，可能需要重新登录 B站');
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
