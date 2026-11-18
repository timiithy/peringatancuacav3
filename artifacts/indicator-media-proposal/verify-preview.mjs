import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(dir, '../../frontend/package.json'));
const {chromium} = require('@playwright/test');
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
 const page = await browser.newPage({viewport:{width:1400,height:950},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
 await page.locator('article img').last().waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('article img')].every(i=>i.complete&&i.naturalWidth>0));
 assert.equal(await page.locator('article').count(),17);
 assert.equal(await page.locator('article img').count(),17);
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(dir,'preview-desktop.jpg'),fullPage:true,type:'jpeg',quality:80});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(dir,'preview-mobile.jpg'),fullPage:true,type:'jpeg',quality:75});
 await page.getByRole('button',{name:'Replay sketches'}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('article img')].every(i=>i.complete&&i.naturalWidth>0));
 assert.deepEqual(errors,[]);
 console.log('PASS: all 17 images load; no page errors or desktop/mobile overflow; replay works.');
} finally { await browser.close(); }
