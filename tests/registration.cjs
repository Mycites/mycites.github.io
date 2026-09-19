// Run with Playwright installed: node tests/registration.cjs
// Set BROWSER_CHANNEL=msedge to use an installed Edge browser.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const entry = (name = 'Malaclemys terrapin', count = 2) => ({ species:'테라핀', scientificName:name, count });
const doc = (id, entries = [entry()], extra = {}) => ({ id, title:`서류 ${id}`, speciesEntries:entries, initialCount:entries.reduce((sum, item) => sum + item.count, 0), animalIds:[], quantityChanges:[], createdAt:'2026-01-01', ...extra });

function unitTests() {
  for (const file of ['animal-register.html', 'documents.html', 'animal-detail.html', 'index.html']) {
    for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename:file });
  }
  let values = {}, failAnimals = false;
  const localStorage = {
    getItem:key => values[key] ?? null,
    setItem:(key, value) => { if (failAnimals && key === 'cites-animals') throw new Error('quota'); values[key] = value; },
    removeItem:key => { delete values[key]; }
  };
  const context = { window:{}, localStorage, CitesStorage:localStorage };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/document-links.js'), 'utf8'), context);
  const { candidates, saveAnimal } = context.window.CitesDocumentLinks;
  const animal = { id:'a', species:'테라핀', scientificName:'Malaclemys terrapin' };
  assert.equal(candidates('', [doc('x')], []).length, 0);
  assert.equal(candidates(' malaclemys  TERRAPIN ', [doc('x')], [])[0].slots, 2);
  assert.equal(candidates(animal.scientificName, [doc('x', [entry()], {animalIds:['a']})], [animal])[0].slots, 1);
  assert.equal(candidates(animal.scientificName, [doc('x', [entry()], {quantityChanges:[{species:'테라핀', count:2}]})], [])[0].slots, 0);
  values['cites-documents'] = JSON.stringify([doc('x')]);
  const oldDocs = values['cites-documents'];
  failAnimals = true;
  assert.throws(() => saveAnimal(animal, ['x']), /저장/);
  assert.equal(values['cites-documents'], oldDocs);
  assert.equal(values['cites-animals'], undefined);
  failAnimals = false;
  assert.throws(() => saveAnimal(animal, ['missing']), /변경/);
  saveAnimal(animal, ['x']);
  assert.deepEqual(JSON.parse(values['cites-documents'])[0].animalIds, ['a']);
  assert.equal(JSON.parse(values['cites-animals'])[0].id, 'a');
  console.log('PASS syntax, candidate capacity, normalization, stale selection, quota rollback');
}

(async () => {
  unitTests();
  const server = http.createServer((req, res) => {
    const filename = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(filename));
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/animal-register.html`);
    const fixtures = [doc('available'), doc('full', [entry('Malaclemys terrapin', 1)], {animalIds:['old']}), doc('spent', [entry()], {quantityChanges:[{species:'테라핀', count:2}]}), doc('other', [entry('Other species')])];
    await page.evaluate(documents => {
      localStorage.setItem('cites-documents', JSON.stringify(documents));
      localStorage.setItem('cites-animals', JSON.stringify([{id:'old', name:'기존 동물', species:'테라핀', scientificName:'Malaclemys terrapin'}]));
    }, fixtures);
    await page.reload();
    await page.locator('#species').fill('테라핀');
    await page.locator('#scientific-name').selectOption('Malaclemys terrapin');
    assert.equal(await page.locator('#document-candidates input').count(), 4);
    assert.equal(await page.locator('#document-candidates input:disabled').count(), 0);
    await page.locator('#document-candidates input[value=available]').check();
    await page.locator('#scientific-name').selectOption('Other species');
    assert.equal(await page.locator('#document-candidates input:checked').count(), 0);
    await page.locator('#scientific-name').selectOption('Malaclemys terrapin');
    await page.locator('#document-candidates input[value=available]').check();
    await page.locator('#category').selectOption('거북이');
    await page.locator('#animal-name').fill('연결 검사');
    await page.locator('#next').click(); await page.locator('#next').click();
    assert.match(await page.locator('#summary-documents').innerText(), /available/);
    await page.locator('#done').click(); await page.waitForURL('**/animal-detail.html?id=*');
    assert.match(await page.locator('#documents').innerText(), /available/);
    const data = await page.evaluate(() => ({animals:JSON.parse(localStorage.getItem('cites-animals')), documents:JSON.parse(localStorage.getItem('cites-documents'))}));
    assert(data.documents[0].animalIds.includes(data.animals[0].id));
    console.log('PASS registration, matching/exhausted/full candidates, selection reset, linked detail');

    // Build synthetic fixtures in memory; no user records or documents are used.
    const fixturePage = await browser.newPage();
    await fixturePage.setContent('<html><body style="font:28px Arial;padding:30px"><p>서류 이름: 야생생물 수입 허가서</p><p>허가번호: KR-2026-001</p><p>테라핀 Malaclemys terrapin 2</p><p>거북이 Testudo graeca 3</p></body></html>');
    const pdfBuffer = await fixturePage.pdf({format:'A4'});
    await fixturePage.setViewportSize({width:1200, height:600});
    await fixturePage.setContent('<html><body style="margin:0;background:white;font:44px Arial;padding:40px"><p>IMPORT PERMIT</p><p>Permit No: KR-2026-001</p><p>테라핀 Malaclemys terrapin 2</p><p>거북이 Testudo graeca 3</p></body></html>');
    const imageBuffer = await fixturePage.screenshot();
    await fixturePage.setContent(`<html><body style="margin:0"><img style="width:100%" src="data:image/png;base64,${imageBuffer.toString('base64')}"></body></html>`);
    const scannedPdf = await fixturePage.pdf({format:'A4'});
    await fixturePage.close();

    await page.goto(`${base}/documents.html`); await page.locator('#document-toggle').click();
    const metadataCases = await page.evaluate(() => [
      CitesDocumentExtract.parseMetadata('문서명: 수입허가서\n관리번호: A-2026-12'),
      CitesDocumentExtract.parseMetadata('수출 허가서\n발급 번호\nKR-2026-02'),
      CitesDocumentExtract.parseMetadata('IMPORT PERMIT\nPermit No: US-01\nCertificate number: US-02'),
      CitesDocumentExtract.parseMetadata('촬영일 2026-09-17\n테라핀 Malaclemys terrapin 2')
    ]);
    assert.deepEqual(metadataCases[0], {titles:['수입허가서'],references:['A-2026-12']});
    assert.equal(metadataCases[1].references[0], 'KR-2026-02');
    assert.equal(metadataCases[2].references.length, 2);
    assert.deepEqual(metadataCases[3], {titles:[],references:[]});
    const manual = await browser.newPage(); const manualRequests = [];
    manual.on('request', request => { if (!request.url().startsWith(base)) manualRequests.push(request.url()); });
    await manual.goto(base + '/documents.html'); await manual.locator('#document-toggle').click();
    await manual.locator('#document-file').setInputFiles({name:'manual.png',mimeType:'image/png',buffer:imageBuffer});
    assert.equal(await manual.locator('#extract-choice').isVisible(), true);
    await manual.locator('#extract-manual').click();
    assert.equal(await manual.locator('#extract-review').isVisible(), false);
    await manual.locator('#document-title').fill('수동 서류'); await manual.locator('#document-reference').fill('MANUAL-1');
    await manual.locator('.species-name').fill('테라핀');
    await Promise.all([manual.waitForEvent('domcontentloaded'), manual.locator('button[type=submit]').click()]);
    assert.equal(await manual.evaluate(() => JSON.parse(localStorage.getItem('cites-documents'))[0].reference), 'MANUAL-1');
    assert.deepEqual(manualRequests, []); await manual.close();
    console.log('PASS manual save without OCR/network, Korean/English/multiline metadata, no false date reference');
    const parse = await page.evaluate(() => CitesDocumentExtract.parseSpecies('테라핀 Malaclemys terrapin 2\n거북이 Testudo graeca 수량: 3\nScientific name\nMalaclemys terrapin quantity: 4'));
    assert.equal(parse.length, 3); assert.equal(parse[0].species, '테라핀'); assert.equal(parse[0].count, 2); assert.equal(parse[1].count, 3); assert.equal(parse[2].count, 4);
    await page.locator('#document-file').setInputFiles({name:'text.pdf',mimeType:'application/pdf',buffer:pdfBuffer});
    assert.equal(await page.locator('#extract-choice').isVisible(), true);
    await page.locator('#extract-auto').click();
    await page.waitForFunction(() => !document.getElementById('extract-start').disabled, null, { timeout:180000 });
    assert.match(await page.locator('#extract-status').innerText(), /추출 완료/);
    assert.match(await page.locator('#extract-text').inputValue(), /Malaclemys terrapin/);
    assert.equal(await page.locator('#extract-title').inputValue(), '야생생물 수입 허가서');
    assert.equal(await page.locator('#extract-reference').inputValue(), 'KR-2026-001');
    assert.equal(await page.locator('#document-title').inputValue(), '');
    await page.locator('#extract-metadata-apply').click();
    assert.equal(await page.locator('#document-title').inputValue(), '야생생물 수입 허가서');
    assert.equal(await page.locator('#document-reference').inputValue(), 'KR-2026-001');
    assert.equal(await page.locator('#extract-suggestions .extract-row').count(), 2);
    await page.locator('#extract-apply').click();
    assert.equal(await page.locator('.species-entry').count(), 2);
    assert.equal(await page.locator('.species-count').first().inputValue(), '2');
    console.log('PASS real PDF text extraction, Korean species and quantity suggestions, review/apply');
    for (const width of [1280,375,320]) {
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.TEST_SCREENSHOTS) await page.screenshot({path:path.join(process.env.TEST_SCREENSHOTS, 'extract-' + width + '.png'),fullPage:true});
    }

    for (const [name,mimeType,buffer,force] of [['photo.png','image/png',imageBuffer,false], ['scanned.pdf','application/pdf',scannedPdf,false], ['forced.pdf','application/pdf',pdfBuffer,true]]) {
      await page.locator('#document-file').setInputFiles({name,mimeType,buffer});
      await page.locator(force ? '#extract-ocr' : '#extract-start').click();
      await page.waitForFunction(() => !document.getElementById('extract-start').disabled, null, { timeout:180000 });
      assert.match(await page.locator('#extract-status').innerText(), /추출 완료/);
      assert.match(await page.locator('#extract-text').inputValue(), /Malaclemys\s+terrapin/i);
      if (!force) assert.equal(await page.locator('#extract-reference').inputValue(), 'KR-2026-001');
      else assert.match(await page.locator('#extract-text').inputValue(), /2026-001/); // OCR may misread KR; do not invent a corrected identifier.
      assert.equal(await page.locator('#extract-reference-use').isChecked(), false);
      assert.equal(await page.locator('#document-reference').inputValue(), 'KR-2026-001');
      console.log(`PASS real OCR and reference extraction ${name}`);
    }
    await page.locator('#extract-reference').fill('CORRECTED-2');
    await page.locator('#extract-metadata-apply').click();
    assert.equal(await page.locator('#document-reference').inputValue(), 'KR-2026-001');
    await page.locator('#extract-reference-use').check(); await page.locator('#extract-metadata-apply').click();
    assert.equal(await page.locator('#document-reference').inputValue(), 'CORRECTED-2');
    await page.locator('summary').filter({hasText:'추출문 보기'}).click();
    await page.locator('#extract-text').fill('IMPORT PERMIT\nPermit No: A-1\nCertificate No: B-2');
    await page.locator('#extract-reparse').click();
    assert.equal(await page.locator('#extract-reference').inputValue(), '');
    assert.equal(await page.locator('#extract-reference-options option').count(), 2);
    assert.equal(await page.locator('#document-reference').inputValue(), 'CORRECTED-2');
    console.log('PASS preserve existing fields, explicit overwrite, ambiguous reference selection');
    await page.locator('#document-file').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});
    await page.locator('#extract-start').click();
    await page.waitForFunction(() => !document.getElementById('extract-start').disabled);
    assert.match(await page.locator('#extract-status').innerText(), /추출하지 못했습니다/);
    await page.locator('#document-file').setInputFiles({name:'large.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(1024*1024+1)});
    await page.locator('#extract-start').click(); assert.match(await page.locator('#extract-status').innerText(), /1MB/);
    await page.locator('#document-file').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:imageBuffer});
    await page.locator('#extract-start').click(); await page.locator('#extract-cancel').click();
    assert.match(await page.locator('#extract-status').innerText(), /취소/);
    assert.equal(await page.locator('#extract-review').isVisible(), false);
    for (const width of [1280,375,320]) {
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.goto(base + '/animal-register.html');
    await page.locator('#species').fill('테라핀'); await page.locator('#scientific-name').selectOption('Malaclemys terrapin');
    for (const width of [1280,375,320]) {
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.TEST_SCREENSHOTS) await page.screenshot({path:path.join(process.env.TEST_SCREENSHOTS, 'candidates-' + width + '.png'),fullPage:true});
    }
    assert.deepEqual(errors, []);
    console.log('PASS invalid/oversize files, cancel, mobile layout, no page errors');
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

