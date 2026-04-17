#!/usr/bin/env node
// linkedin-batch-job-search.js — 批量搜索 LinkedIn 岗位
// 在已登录的 Chrome 中通过 CDP 搜索多个关键词/地区组合

const {WebSocket} = require('ws');
const fs = require('fs');

const SEARCHES = [
  { keywords: "AIGC AI creative", location: "Germany", region: "🇩🇪 Germany" },
  { keywords: "AI agent AI automation", location: "Germany", region: "🇩🇪 Germany" },
  { keywords: "AIGC AI creative", location: "Switzerland", region: "🇨🇭 Switzerland" },
  { keywords: "AI agent automation", location: "Switzerland", region: "🇨🇭 Switzerland" },
  { keywords: "AIGC AI creative tech", location: "United States", region: "🇺🇸 USA" },
  { keywords: "AI agent AI automation", location: "United States", region: "🇺🇸 USA" },
  { keywords: "AIGC AI creative", location: "Canada", region: "🇨🇦 Canada" },
  { keywords: "AIGC AI creative", location: "China", region: "🇨🇳 China" },
  { keywords: "AI agent automation", location: "China", region: "🇨🇳 China" },
  { keywords: "AIGC AI creative", location: "Hong Kong", region: "🇭🇰 Hong Kong" },
  { keywords: "AIGC AI creative", location: "Singapore", region: "🇸🇬 Singapore" },
  { keywords: "AI agent automation", location: "Singapore", region: "🇸🇬 Singapore" },
];

async function run() {
  const allJobs = [];
  
  for (const search of SEARCHES) {
    console.error(`\n--- Searching: "${search.keywords}" in "${search.location}" ---`);
    
    try {
      const jobs = await searchJobs(search);
      console.error(`Found ${jobs.length} jobs`);
      
      for (const job of jobs) {
        allJobs.push({
          region: search.region,
          location: search.location,
          ...job
        });
      }
      
      // Wait between searches to avoid rate limiting
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }
  
  // Deduplicate by URL
  const seen = new Set();
  const unique = allJobs.filter(j => {
    const id = j.url.match(/\/jobs\/view\/(\d+)/)?.[1] || j.url;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  
  console.log(JSON.stringify(unique, null, 2));
  console.error(`\nTotal unique jobs: ${unique.length}`);
}

async function searchJobs(search) {
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
      setTimeout(() => reject(new Error(`Timeout: ${method}`)), 30000);
    });
  };

  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(search.keywords)}&location=${encodeURIComponent(search.location)}&f_TPR=r2592000&position=1&pageNum=0`;
  
  await send('Page.enable');
  await send('Page.navigate', { url: searchUrl });
  await new Promise(r => setTimeout(r, 6000));

  // Check if redirected to login
  const urlResult = await send('Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true
  });
  const currentUrl = urlResult.result?.value || '';
  if (currentUrl.includes('/login') || currentUrl.includes('/uas/login')) {
    ws.close();
    throw new Error('Session expired - redirected to login');
  }

  // Scroll to load more
  for (let i = 0; i < 3; i++) {
    await send('Runtime.evaluate', { expression: 'window.scrollBy(0, 3000)', returnByValue: true });
    await new Promise(r => setTimeout(r, 1500));
  }

  // Extract jobs
  const extractResult = await send('Runtime.evaluate', {
    expression: `(function(){
      var jobs=[];
      var cards=document.querySelectorAll(".job-card-container,[class*=job-card-container]");
      if(cards.length===0){
        cards=document.querySelectorAll("[data-entity-urn*=jobPosting]");
      }
      cards.forEach(function(card){
        var linkEl=card.querySelector("a[href*='/jobs/view/']");
        var url=linkEl?linkEl.href:"";
        var jobId=url.match(/\\/jobs\\/view\\/(\\d+)/);
        if(!jobId)return;
        
        var titleEl=card.querySelector(".job-card-container__link,[class*=job-card-list__title],h3");
        var title=titleEl?titleEl.textContent.trim().replace(/\\s+/g," ").substring(0,120):"";
        if(!title&&linkEl)title=linkEl.textContent.trim().replace(/\\s+/g," ").substring(0,120);
        
        var companyEl=card.querySelector(".job-card-container__company-name,[class*=company-name],h4,[class*=subtitle]");
        var company=companyEl?companyEl.textContent.trim().replace(/\\s+/g," "):"";
        
        var locEl=card.querySelector(".job-card-container__metadata-item,[class*=metadata],[class*=location]");
        var location=locEl?locEl.textContent.trim().replace(/\\s+/g," "):"";
        
        var dateEl=card.querySelector("time");
        var date=dateEl?(dateEl.getAttribute("datetime")||dateEl.textContent.trim()):"";
        
        if(title)jobs.push({title:title,company:company,location:location,url:"https://www.linkedin.com/jobs/view/"+jobId[1],date:date});
      });
      return JSON.stringify(jobs);
    })()`,
    returnByValue: true
  });

  ws.close();
  
  try {
    return JSON.parse(extractResult.result?.value || '[]');
  } catch {
    return [];
  }
}

run();
