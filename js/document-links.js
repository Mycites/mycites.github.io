(() => {
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const isEvent = doc => ['transfer', 'death'].includes(doc.kind);
  const sameSpecies = (a, b) => normalize(a).replaceAll(' ', '') === normalize(b).replaceAll(' ', '');
  function candidates(scientificName, documents, animals) {
    const target = typeof scientificName === 'object' ? scientificName : { scientificName };
    if (!normalize(target.scientificName) && !normalize(target.species)) return [];
    const matchesAnimal = (entry, animal) => entry.scientificName && animal.scientificName
      ? normalize(entry.scientificName) === normalize(animal.scientificName)
      : Boolean(entry.species && animal.species && sameSpecies(entry.species, animal.species));
    return documents.filter(doc => !isEvent(doc)).flatMap(doc => {
      const entries = doc.speciesEntries?.length ? doc.speciesEntries : [{ ...doc, count:doc.initialCount ?? (doc.animalIds || []).length }];
      const matches = entries.filter(entry => matchesAnimal(entry, target));
      if (!matches.length) return [];
      const count = matches.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
      const used = (doc.quantityChanges || []).filter(change => matches.some(entry => sameSpecies(entry.species, change.species)))
        .reduce((sum, change) => sum + Number(change.count || 0), 0);
      const ids = new Set(doc.animalIds || []);
      const unknown = [...ids].filter(id => !animals.some(animal => animal.id === id)).length;
      const linked = animals.filter(animal => ids.has(animal.id) && matches.some(entry => matchesAnimal(entry, animal))).length + unknown;
      // Linked animals remain part of the original allocation even after transfer.
      const totalRemaining = Number(doc.initialCount ?? count) - (doc.quantityChanges || []).reduce((sum, change) => sum + Number(change.count || 0), 0);
      const slots = Math.max(0, Math.min(count - linked, count - used, totalRemaining, Number(doc.initialCount ?? entries.reduce((sum, entry) => sum + Number(entry.count || 0), 0)) - ids.size));
      return [{ document:doc, slots, linked }];
    });
  }
  function saveAnimal(animal, documentIds, editing = false) {
    const oldAnimals = localStorage.getItem('cites-animals');
    const oldDocuments = localStorage.getItem('cites-documents');
    const animals = JSON.parse(oldAnimals || '[]');
    const previous = animals.find(item => item.id === animal.id);
    if (editing && !previous) throw new Error('수정할 동물이 삭제되었습니다. 목록을 새로고침해 주세요.');
    if (editing && previous.statusDocumentId && animal.status !== previous.status) throw new Error('양도·폐사 서류로 처리된 상태입니다. 해당 서류를 삭제해 처리를 되돌린 뒤 변경해 주세요.');
    if (editing) animal = { ...previous, ...animal, createdAt:previous.createdAt, updatedAt:new Date().toISOString() };
    const documents = JSON.parse(oldDocuments || '[]');
    const available = candidates(animal, documents, animals);
    const selected = [...new Set(documentIds)];
    selected.forEach(id => {
      const match = available.find(item => item.document.id === id);
      const retained = editing && match && (match.document.animalIds || []).includes(animal.id);
      if (!match || (!retained && match.slots < 1)) throw new Error('선택한 서류의 학명이나 수량이 변경되었습니다. 서류 후보를 다시 확인해 주세요.');
      match.document.animalIds = [...new Set([...(match.document.animalIds || []), animal.id])];
    });
    if (editing) documents.forEach(doc => { if (!isEvent(doc) && !selected.includes(doc.id)) doc.animalIds = (doc.animalIds || []).filter(id => id !== animal.id); });
    let documentsWritten = false;
    const oldShared = localStorage.getItem("cites-shared-photos");
    let sharedWritten = false;
    try {
      if (selected.length || editing) {
        localStorage.setItem('cites-documents', JSON.stringify(documents));
        documentsWritten = true;
      }
      const nextAnimals = editing ? animals.map(item => item.id === animal.id ? animal : item) : [animal, ...animals];
      const packed = window.CitesPhotos ? CitesPhotos.compact(nextAnimals) : {animals:nextAnimals};
      if (packed.photos) { localStorage.setItem('cites-shared-photos', JSON.stringify(packed.photos)); sharedWritten = true; }
      localStorage.setItem('cites-animals', JSON.stringify(packed.animals));
    } catch (error) {
      if (sharedWritten) { if (oldShared === null) localStorage.removeItem("cites-shared-photos"); else localStorage.setItem("cites-shared-photos", oldShared); }
      if (documentsWritten) {
        if (oldDocuments === null) localStorage.removeItem('cites-documents');
        else localStorage.setItem('cites-documents', oldDocuments);
      }
      throw new Error('저장 공간이 부족하거나 저장할 수 없습니다. 사진 용량을 줄인 뒤 다시 시도해 주세요.', { cause:error });
    }
  }
  function saveLinks(animalId, documentIds) {
    const animals = JSON.parse(localStorage.getItem('cites-animals') || '[]');
    const animal = animals.find(item => item.id === animalId);
    if (!animal) throw new Error('동물 기록을 찾을 수 없습니다. 새로고침해 주세요.');
    const documents = JSON.parse(localStorage.getItem('cites-documents') || '[]');
    const available = candidates(animal, documents, animals);
    const selected = new Set(documentIds);
    selected.forEach(id => {
      const doc = documents.find(item => item.id === id);
      if (!doc) throw new Error('선택한 서류가 없어졌습니다. 다시 선택해 주세요.');
      if (isEvent(doc)) throw new Error('양도·폐사 서류의 동물은 서류 등록에서 처리해 주세요.');
      if ((doc.animalIds || []).includes(animalId)) return;
      const match = available.find(item => item.document.id === id);
      if (!match || match.slots < 1) throw new Error('서류의 종 또는 수량이 변경되어 연결할 수 없습니다. 다시 확인해 주세요.');
    });
    documents.filter(doc => !isEvent(doc)).forEach(doc => {
      const ids = new Set(doc.animalIds || []);
      if (selected.has(doc.id)) ids.add(animalId); else ids.delete(animalId);
      doc.animalIds = [...ids];
    });
    try { localStorage.setItem('cites-documents', JSON.stringify(documents)); }
    catch { throw new Error('서류 연결을 저장하지 못했습니다. 저장 공간을 확인해 주세요.'); }
  }
  function previewFile(doc) {
    const match = /^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(doc.fileData || '');
    if (!match) { alert('이 파일은 미리 볼 수 없습니다. 서류 수정에서 PDF 또는 사진을 다시 첨부해 주세요.'); return; }
    let url;
    try { url = URL.createObjectURL(new Blob([Uint8Array.from(atob(match[2]), character => character.charCodeAt(0))], {type:match[1]})); }
    catch { alert('첨부 파일을 읽지 못했습니다. 서류 파일을 다시 확인해 주세요.'); return; }
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'width:min(960px,94vw);max-width:94vw;height:88vh;max-height:88vh;padding:18px;border:1px solid #bcd6c9;border-radius:14px;color:#18352d;background:white;box-sizing:border-box;';
    dialog.setAttribute('aria-label', '첨부 서류 보기');
    const panel = document.createElement('div'); panel.style.cssText = 'height:100%;display:flex;flex-direction:column;gap:12px;min-width:0';
    const header = document.createElement('div'); header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px';
    const title = document.createElement('strong'); title.textContent = doc.title || '첨부 서류'; title.style.overflowWrap = 'anywhere';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '닫기'; close.className = 'cancel'; close.style.flexShrink = '0'; close.addEventListener('click', () => dialog.close());
    header.append(title, close);
    const download = document.createElement('a'); download.href = url; download.download = doc.fileName || (match[1] === 'application/pdf' ? '서류.pdf' : '서류사진'); download.textContent = '첨부 파일 내려받기';
    const hint = document.createElement('small'); hint.textContent = '미리보기가 나타나지 않으면 파일을 내려받아 확인하세요.';
    const viewer = document.createElement(match[1] === 'application/pdf' ? 'iframe' : 'img');
    viewer.src = url; viewer.style.cssText = 'width:100%;flex:1;min-height:0;border:0;object-fit:contain;background:#f5f8f6';
    if (viewer.tagName === 'IFRAME') viewer.title = 'PDF 서류 미리보기'; else viewer.alt = doc.fileName || '첨부 서류 사진';
    panel.append(header, download, hint, viewer); dialog.append(panel); document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); URL.revokeObjectURL(url); }, {once:true});
    dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
    dialog.showModal(); close.focus();
  }
  function renderPicker(container, target, selectedIds = []) {
    const documents = JSON.parse(localStorage.getItem('cites-documents') || '[]');
    const animals = JSON.parse(localStorage.getItem('cites-animals') || '[]');
    const available = candidates(target, documents, animals);
    container.replaceChildren();
    if (!documents.length) {
      const message = document.createElement('p'); message.textContent = '등록된 서류가 없습니다. 서류 · 사진 화면에서 먼저 등록해 주세요.'; container.append(message); return;
    }
    documents.filter(doc => !isEvent(doc)).forEach(doc => {
      const match = available.find(item => item.document.id === doc.id);
      if (!target.id && (!match || match.slots < 1)) return;
      const alreadyLinked = Boolean(target.id && (doc.animalIds || []).includes(target.id));
      const label = document.createElement('label'); label.className = 'document-candidate';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = doc.id;
      input.checked = selectedIds.includes(doc.id) && (alreadyLinked || Boolean(match?.slots > 0));
      input.setAttribute('aria-label', doc.title || '이름 없는 서류');
      const text = document.createElement('span'); text.textContent = doc.title || '이름 없는 서류';
      const detail = document.createElement('small');
      detail.textContent = [doc.reference, alreadyLinked ? '현재 연결됨' : '', match ? `추가 연결 가능 ${match.slots}마리` : '종명·학명 불일치'].filter(Boolean).join(' · ');
      text.append(detail); label.append(input, text);
      text.style.minWidth = '0'; text.style.flex = '1'; label.style.flexWrap = 'wrap';
      if (doc.fileData) {
        const view = document.createElement('button'); view.type = 'button'; view.textContent = '서류 보기'; view.className = 'cancel';
        view.style.cssText = 'flex-shrink:0;padding:6px 10px;font-size:.8rem';
        view.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); previewFile(doc); }); label.append(view);
      } else { const missing = document.createElement('small'); missing.textContent = '첨부 없음'; label.append(missing); }
      container.append(label);
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const freshDocuments = JSON.parse(localStorage.getItem('cites-documents') || '[]');
        const freshAnimals = JSON.parse(localStorage.getItem('cites-animals') || '[]');
        const fresh = freshDocuments.find(item => item.id === doc.id);
        if (target.id && (fresh?.animalIds || []).includes(target.id)) return;
        const current = candidates(target, freshDocuments, freshAnimals).find(item => item.document.id === doc.id);
        if (!current || current.slots < 1) {
          input.checked = false;
          alert(current ? '이 서류의 등록 수량을 초과하므로 선택할 수 없습니다. 다른 서류를 선택해 주세요.' : '동물의 종명·학명과 맞는 등록 서류를 선택해 주세요.');
        }
      });
    });
    if (!container.children.length) { const message = document.createElement('p'); message.textContent = '현재 종에 연결 가능한 서류가 없습니다. 서류 없이 등록하거나 새 서류를 추가할 수 있어요.'; container.append(message); }
  }
  window.CitesDocumentLinks = { candidates, saveAnimal, saveLinks, renderPicker, previewFile };
})();
