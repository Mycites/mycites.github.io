(() => {
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const sameSpecies = (a, b) => normalize(a).replaceAll(' ', '') === normalize(b).replaceAll(' ', '');
  function candidates(scientificName, documents, animals) {
    const target = typeof scientificName === 'object' ? scientificName : { scientificName };
    if (!normalize(target.scientificName) && !normalize(target.species)) return [];
    const matchesAnimal = (entry, animal) => entry.scientificName && animal.scientificName
      ? normalize(entry.scientificName) === normalize(animal.scientificName)
      : Boolean(entry.species && animal.species && sameSpecies(entry.species, animal.species));
    return documents.flatMap(doc => {
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
    if (editing) documents.forEach(doc => { if (!selected.includes(doc.id)) doc.animalIds = (doc.animalIds || []).filter(id => id !== animal.id); });
    let documentsWritten = false;
    try {
      if (selected.length || editing) {
        localStorage.setItem('cites-documents', JSON.stringify(documents));
        documentsWritten = true;
      }
      localStorage.setItem('cites-animals', JSON.stringify(editing ? animals.map(item => item.id === animal.id ? animal : item) : [animal, ...animals]));
    } catch (error) {
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
      if ((doc.animalIds || []).includes(animalId)) return;
      const match = available.find(item => item.document.id === id);
      if (!match || match.slots < 1) throw new Error('서류의 종 또는 수량이 변경되어 연결할 수 없습니다. 다시 확인해 주세요.');
    });
    documents.forEach(doc => {
      const ids = new Set(doc.animalIds || []);
      if (selected.has(doc.id)) ids.add(animalId); else ids.delete(animalId);
      doc.animalIds = [...ids];
    });
    try { localStorage.setItem('cites-documents', JSON.stringify(documents)); }
    catch { throw new Error('서류 연결을 저장하지 못했습니다. 저장 공간을 확인해 주세요.'); }
  }
  function renderPicker(container, target, selectedIds = []) {
    const documents = JSON.parse(localStorage.getItem('cites-documents') || '[]');
    const animals = JSON.parse(localStorage.getItem('cites-animals') || '[]');
    const available = candidates(target, documents, animals);
    container.replaceChildren();
    if (!documents.length) {
      const message = document.createElement('p'); message.textContent = '등록된 서류가 없습니다. 서류 · 사진 화면에서 먼저 등록해 주세요.'; container.append(message); return;
    }
    documents.forEach(doc => {
      const match = available.find(item => item.document.id === doc.id);
      const alreadyLinked = Boolean(target.id && (doc.animalIds || []).includes(target.id));
      const label = document.createElement('label'); label.className = 'document-candidate';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = doc.id;
      input.checked = selectedIds.includes(doc.id) && (alreadyLinked || Boolean(match?.slots > 0));
      input.setAttribute('aria-label', doc.title || '이름 없는 서류');
      const text = document.createElement('span'); text.textContent = doc.title || '이름 없는 서류';
      const detail = document.createElement('small');
      detail.textContent = [doc.reference, alreadyLinked ? '현재 연결됨' : '', match ? `추가 연결 가능 ${match.slots}마리` : '종명·학명 불일치'].filter(Boolean).join(' · ');
      text.append(detail); label.append(input, text); container.append(label);
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
  }
  window.CitesDocumentLinks = { candidates, saveAnimal, saveLinks, renderPicker };
})();
