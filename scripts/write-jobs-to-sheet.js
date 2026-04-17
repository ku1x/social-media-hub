#!/usr/bin/env node
// write-jobs-to-sheet.js — Write job data to Google Sheet via gog CLI
const { execSync } = require('child_process');
const fs = require('fs');

const SHEET_ID = '1JxpqwcDgxZysCwHUYS8SQwKM3Db0cGG0FeLefvpKsgo';
const env = {
  PATH: '/home/node/.openclaw/tools/bin:/home/node/.local/bin:/usr/local/bin:/usr/bin:/bin',
  XDG_CONFIG_HOME: '/home/node/.openclaw/config',
  GOG_KEYRING_PASSWORD: 'KuiClaw1997',
  HOME: '/home/node',
};

function gogSheetsAppend(range, values) {
  const args = values.map(v => `"${v.replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `gog sheets append "${SHEET_ID}" "${range}" ${args}`;
  try {
    return execSync(cmd, { env, timeout: 15000, encoding: 'utf-8' }).trim();
  } catch (e) {
    return `ERROR: ${e.message.substring(0, 100)}`;
  }
}

// Read the LinkedIn search results
const linkedinJobs = JSON.parse(fs.readFileSync('/dev/stdin', 'utf-8'));

let row = 2;
let success = 0;
let errors = 0;

for (const job of linkedinJobs) {
  // Clean up title (remove duplicate text from LinkedIn)
  let title = job.title || '';
  const halfLen = Math.floor(title.length / 2);
  if (title.substring(0, halfLen) === title.substring(halfLen)) {
    title = title.substring(0, halfLen).trim();
  }
  
  // Remove "with verification" suffix
  title = title.replace(/\s*with verification\s*$/i, '').trim();
  
  const values = [
    job.region || '',
    job.location || '',
    title,
    job.company || '',
    job.date || '',
    job.source || 'LinkedIn',
    job.url || '',
    job.notes || ''
  ];
  
  const result = gogSheetsAppend(`A${row}:H${row}`, values);
  if (result.includes('ERROR')) {
    errors++;
    console.error(`Row ${row} error: ${result}`);
  } else {
    success++;
  }
  row++;
}

console.log(`Written ${success} rows, ${errors} errors`);
