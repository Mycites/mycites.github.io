(() => {
  const PDF_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624';
  const OCR_BASE = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist';
  const byId = id => document.getElementById(id);
  let activeJob = null;
  let ocrLibrary;
  function loadOcr() {
    if (!ocrLibrary) ocrLibrary = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${OCR_BASE}/tesseract.min.js`;
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => { script.remove(); ocrLibrary = null; reject(new Error('OCR 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      document.head.append(script);
    });
    return ocrLibrary;
  }
  function check(job) {
    if (activeJob !== job) throw new Error('취소되었습니다.');
  }
  function status(message) { byId('extract-status').textContent = message; }
  function busy(value) {
    byId('extract-start').disabled = value;
    byId('extract-ocr').disabled = value;
    byId('extract-cancel').hidden = !value;
  }
  function release(job) {
    if (!job) return;
    clearTimeout(job.timer);
    if (job.worker) { void job.worker.terminate().catch(() => {}); job.worker = null; }
    if (job.pdfTask) { void job.pdfTask.destroy().catch(() => {}); job.pdfTask = null; }
  }
  function cancel(message = '추출을 취소했습니다. 직접 입력하거나 다시 시도할 수 있어요.') {
    const job = activeJob; activeJob = null; release(job); busy(false);
    status(message);
  }
  async function recognize(source, job, pageLabel) {
    if (!job.worker) {
      status('무료 OCR 준비 중 · 처음에는 한글·영문 인식 자료를 내려받습니다.');
      const library = await loadOcr(); check(job);
      const worker = await library.createWorker('kor+eng', 1, {
        workerPath:`${OCR_BASE}/worker.min.js`,
        corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
        errorHandler:() => { if (activeJob === job) cancel('OCR 도구를 실행하지 못했습니다. 인터넷 연결을 확인하거나 직접 입력해 주세요.'); },
        logger:message => {
          if (activeJob === job && message.status === 'recognizing text') {
            status(`${job.pageLabel || pageLabel} · OCR ${Math.round(message.progress * 100)}%`);
          }
        }
      });
      if (activeJob !== job) { await worker.terminate(); check(job); }
      job.worker = worker;
    }
    job.pageLabel = pageLabel;
    const result = await job.worker.recognize(source); check(job);
    return result.data.text;
  }
  function textLines(items) {
    const lines = [];
    let line = '', y = null;
    for (const item of items) {
      if (typeof item.str !== 'string') continue;
      const nextY = item.transform?.[5];
      if (line && y !== null && nextY !== undefined && Math.abs(y - nextY) > 4) { lines.push(line); line = ''; }
      line += `${item.str} `;
      y = nextY;
      if (item.hasEOL) { lines.push(line); line = ''; y = null; }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }
  async function extract(file, forceOcr, job) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const pdfjs = await import(`${PDF_BASE}/build/pdf.min.mjs`); check(job);
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_BASE}/build/pdf.worker.min.mjs`;
      const data = await file.arrayBuffer(); check(job);
      job.pdfTask = pdfjs.getDocument({ data, isEvalSupported:false,
        cMapUrl:`${PDF_BASE}/cmaps/`, cMapPacked:true,
        standardFontDataUrl:`${PDF_BASE}/standard_fonts/` });
      const pdf = await job.pdfTask.promise; check(job);
      if (pdf.numPages > 20) throw new Error('PDF는 한 번에 20쪽까지 읽을 수 있어요. 파일을 나눠 선택해 주세요.');
      const results = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        check(job); status(`PDF ${number}/${pdf.numPages}쪽 읽는 중…`);
        const page = await pdf.getPage(number);
        let text = forceOcr ? '' : textLines((await page.getTextContent()).items);
        check(job);
        if (forceOcr || text.replace(/\s/g, '').length < 20) {
          const initial = page.getViewport({ scale:1 });
          const viewport = page.getViewport({ scale:Math.min(2, 2400 / Math.max(initial.width, initial.height)) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext:canvas.getContext('2d'), viewport }).promise; check(job);
          text = await recognize(canvas, job, `PDF ${number}/${pdf.numPages}쪽`);
          canvas.width = 0; canvas.height = 0;
        }
        results.push(text); page.cleanup();
      }
      return results.join('\n\n');
    }
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error('PDF, PNG, JPG 또는 WebP 파일을 선택해 주세요.');
    const bitmap = await createImageBitmap(file); check(job);
    try {
      const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(bitmap.width * scale); canvas.height = Math.ceil(bitmap.height * scale);
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await recognize(canvas, job, '이미지');
    } finally { bitmap.close(); }
  }
  // These are suggestions, not taxonomic validation. Quantities are only taken
  // from the same line and are never guessed from dates or permit numbers.
  function parseSpecies(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const names = [...line.matchAll(/\b([A-Z][a-z]{2,}\s+[a-z][a-z-]{2,}(?:\s+[a-z][a-z-]{2,})?)\b/g)];
      for (const match of names) {
        const scientificName = match[1].replace(/\s+/g, ' ').replace(/ (quantity|qty|specimens|pcs)$/, '');
        if (/^(Scientific name|Common name|Country of|Date of|Number of|Place of)/i.test(scientificName)) continue;
        const before = line.slice(0, match.index);
        const after = line.slice(match.index + scientificName.length);
        const korean = before.match(/[가-힣][가-힣· -]*[가-힣]/g)?.filter(value => !/^(한글 종명|종명|학명|수량|대상 종|국명)$/.test(value.trim()));
        const amount = after.match(/(?:수량|quantity|qty)\s*[:：]?\s*(\d+)\b|^\s*[|,:;\t ]*\s*(\d+)\s*(?:마리|개체|개|pcs|specimens)?\s*$/i);
        rows.push({ species:korean?.at(-1)?.trim() || '', scientificName, count:amount ? Number(amount[1] || amount[2]) : '' });
      }
    }
    return rows;
  }
  function showSuggestions() {
    const target = byId('extract-suggestions'); target.replaceChildren();
    const rows = parseSpecies(byId('extract-text').value);
    rows.forEach(entry => {
      const row = document.createElement('div'); row.className = 'extract-row';
      [['species', '한글 종명', entry.species], ['scientificName', '학명', entry.scientificName], ['count', '수량', entry.count]].forEach(([key, title, value]) => {
        const label = document.createElement('label'); label.textContent = title;
        const input = document.createElement('input'); input.dataset.key = key; input.value = value;
        if (key === 'count') { input.type = 'text'; input.inputMode = 'numeric'; }
        label.append(input); row.append(label);
      });
      const button = document.createElement('button'); button.type = 'button'; button.className = 'cancel'; button.textContent = '제외';
      button.addEventListener('click', () => row.remove()); row.append(button); target.append(row);
    });
    byId('extract-apply').hidden = rows.length === 0;
    byId('extract-review-help').textContent = rows.length
      ? '종명·학명·수량이 맞는지 원본과 비교하고 수정하세요. 잘못 찾은 항목은 제외하세요. 기존 입력은 덮어쓰지 않습니다.'
      : '종 항목을 자동으로 찾지 못했습니다. 아래 추출문을 참고해 대상 종과 수량을 직접 입력해 주세요.';
  }
  async function start(forceOcr) {
    if (activeJob) return;
    const file = byId('document-file').files[0];
    if (!file) { status('먼저 서류 파일을 선택해 주세요.'); return; }
    if (file.size > 1024 * 1024) { status('현재 서류 저장 한도인 1MB 이하의 파일을 선택해 주세요.'); return; }
    byId('extract-review').hidden = true; byId('extract-text').value = ''; byId('extract-suggestions').replaceChildren();
    const job = {}; activeJob = job; busy(true); status('파일을 읽는 중입니다…');
    job.timer = setTimeout(() => { if (activeJob === job) cancel('추출 시간이 3분을 넘었습니다. 페이지 수를 줄이거나 다시 시도해 주세요.'); }, 180000);
    try {
      const text = await extract(file, forceOcr, job); check(job);
      byId('extract-text').value = text;
      byId('extract-review').hidden = false; showSuggestions();
      status(text.trim() ? '추출 완료 · 내용을 확인한 뒤 입력란에 반영해 주세요.' : '읽을 수 있는 글자가 없습니다. 더 선명한 파일을 선택하거나 직접 입력해 주세요.');
    } catch (error) {
      if (activeJob === job) status(error.name === 'PasswordException'
        ? '암호가 걸린 PDF입니다. 암호를 해제한 사본을 선택해 주세요.'
        : `추출하지 못했습니다. ${error.message || '파일과 인터넷 연결을 확인해 주세요.'} 직접 입력도 가능합니다.`);
    } finally {
      release(job);
      if (activeJob === job) { activeJob = null; busy(false); }
    }
  }
  byId('extract-start').addEventListener('click', () => start(false));
  byId('extract-ocr').addEventListener('click', () => start(true));
  byId('extract-cancel').addEventListener('click', () => cancel());
  byId('extract-reparse').addEventListener('click', showSuggestions);
  byId('extract-apply').addEventListener('click', () => {
    const rows = [...byId('extract-suggestions').querySelectorAll('.extract-row')].map(row => ({
      species:row.querySelector('[data-key="species"]').value.trim(),
      scientificName:row.querySelector('[data-key="scientificName"]').value.trim(),
      count:Number(row.querySelector('[data-key="count"]').value)
    }));
    if (!rows.length || rows.some(row => !row.species || !row.scientificName || !Number.isInteger(row.count) || row.count < 1)) {
      status('각 후보의 한글 종명·학명·수량(1 이상)을 확인해 주세요.'); return;
    }
    document.dispatchEvent(new CustomEvent('cites:extracted-species', { detail:rows }));
  });
  function reset() {
    cancel(''); byId('extract-review').hidden = true; byId('extract-text').value = ''; byId('extract-suggestions').replaceChildren();
  }
  byId('document-file').addEventListener('change', reset);
  byId('document-form').addEventListener('reset', reset);
  window.CitesDocumentExtract = { parseSpecies, textLines };
})();
