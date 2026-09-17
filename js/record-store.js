(() => {
  const read = key => JSON.parse(localStorage.getItem(key) || '[]');
  const normalize = value => String(value || '').replace(/\s/g, '').toLowerCase();
  const matches = (entry, animal) => entry.scientificName && animal.scientificName
    ? normalize(entry.scientificName) === normalize(animal.scientificName)
    : normalize(entry.species) === normalize(animal.species);
  const isEvent = doc => ['transfer', 'death'].includes(doc.kind);
  const entriesOf = doc => doc.speciesEntries?.length ? doc.speciesEntries : [{species:doc.species, scientificName:doc.scientificName, count:doc.initialCount}];
  function eventSpecies(animals) {
    const groups = new Map();
    animals.forEach(animal => {
      const key = normalize(animal.species) + ':' + normalize(animal.scientificName);
      if (!groups.has(key)) groups.set(key, {species:animal.species, scientificName:animal.scientificName || '', count:0});
      groups.get(key).count++;
    });
    return [...groups.values()];
  }
  function write(changes) {
    const previous = Object.fromEntries(Object.keys(changes).map(key => [key, localStorage.getItem(key)]));
    const written = [];
    try {
      for (const [key, value] of Object.entries(changes)) { localStorage.setItem(key, JSON.stringify(value)); written.push(key); }
    } catch (error) {
      for (const key of written.reverse()) { if (previous[key] === null) localStorage.removeItem(key); else localStorage.setItem(key, previous[key]); }
      throw new Error('저장하지 못했습니다. 저장 공간을 확인해 주세요.', { cause:error });
    }
  }
  function saveDocument(input, editing = false) {
    const documents = read('cites-documents');
    const previous = documents.find(doc => doc.id === input.id);
    if (editing && !previous) throw new Error('수정할 서류가 삭제되었습니다. 새로고침해 주세요.');
    const doc = { ...previous, ...input, quantityChanges:previous?.quantityChanges || [], createdAt:previous?.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString() };
    doc.kind = doc.kind || 'acquisition';
    if (!['acquisition', 'transfer', 'death'].includes(doc.kind)) throw new Error('서류 종류를 확인해 주세요.');
    if (!doc.title.trim()) throw new Error('서류 이름을 입력해 주세요.');
    if (editing && (previous.kind || 'acquisition') !== doc.kind) throw new Error('저장된 서류의 종류는 변경할 수 없습니다. 새 서류로 등록해 주세요.');
    if (isEvent(doc)) {
      const animals = read('cites-animals');
      doc.animalIds = [...new Set(doc.animalIds || [])];
      if (editing) {
        if (JSON.stringify([...doc.animalIds].sort()) !== JSON.stringify([...(previous.animalIds || [])].sort())) throw new Error('처리된 동물은 변경할 수 없습니다. 서류를 삭제해 처리를 되돌린 뒤 다시 등록해 주세요.');
        doc.speciesEntries = previous.speciesEntries; doc.initialCount = previous.initialCount; doc.effects = previous.effects;
        write({ 'cites-documents':documents.map(item => item.id === doc.id ? doc : item) });
        return;
      }
      if (!doc.animalIds.length) throw new Error('양도·폐사 처리할 동물을 선택해 주세요.');
      doc.effects = [];
      const targetStatus = doc.kind === 'transfer' ? '양도 완료' : '폐사';
      const selected = doc.animalIds.map(id => animals.find(animal => animal.id === id));
      for (const animal of selected) {
        if (!animal || !['보유 중', '양도 예정'].includes(animal.status)) throw new Error('현재 보유 중인 동물만 처리할 수 있습니다. 목록을 다시 확인해 주세요.');
        const sources = documents.filter(source => !isEvent(source) && (source.animalIds || []).includes(animal.id));
        if (!sources.length) throw new Error(`${animal.name}: 연결된 양수·수입 서류가 없습니다. 먼저 서류를 연결해 주세요.`);
        for (const source of sources) {
          const entry = entriesOf(source).find(entry => matches(entry, animal));
          if (!entry) throw new Error(`${animal.name}: 원래 서류의 종 정보가 맞지 않습니다.`);
          const changes = source.quantityChanges || [];
          const used = changes.filter(change => normalize(change.species) === normalize(entry.species)).reduce((sum, change) => sum + Number(change.count || 0), 0);
          const totalUsed = changes.reduce((sum, change) => sum + Number(change.count || 0), 0);
          if (Number(entry.count) - used < 1 || Number(source.initialCount ?? entriesOf(source).reduce((sum,e) => sum + Number(e.count || 0),0)) - totalUsed < 1) throw new Error(`${source.title}: 남은 수량이 없습니다. 기존 양도·폐사 수량 기록을 먼저 확인해 주세요.`);
          source.quantityChanges = [...changes, {id:doc.id + ':' + animal.id, eventDocumentId:doc.id, animalId:animal.id, species:entry.species, count:1, reason:doc.kind === 'transfer' ? '양도' : '폐사', createdAt:new Date().toISOString()}];
        }
        doc.effects.push({animalId:animal.id, previousStatus:animal.status, sourceDocumentIds:sources.map(source => source.id)});
        animal.status = targetStatus; animal.statusDocumentId = doc.id; animal.updatedAt = new Date().toISOString();
      }
      doc.speciesEntries = eventSpecies(selected); doc.initialCount = selected.length; doc.species = doc.speciesEntries.map(entry => entry.species).join(', ');
      write({ 'cites-documents':[doc, ...documents], 'cites-animals':animals });
      return;
    }
    const entries = doc.speciesEntries;
    if (!entries.length || entries.some(entry => !entry.species || !Number.isInteger(entry.count) || entry.count < 1)) throw new Error('종명과 수량을 확인해 주세요.');
    if (new Set(entries.map(entry => normalize(entry.species))).size !== entries.length) throw new Error('같은 종명은 한 줄로 합쳐 주세요.');
    const animals = read('cites-animals');
    doc.animalIds = [...new Set(doc.animalIds)];
    const linked = doc.animalIds.map(id => animals.find(animal => animal.id === id));
    if (linked.some(animal => !animal || !entries.some(entry => matches(entry, animal)))) throw new Error('연결 동물의 종명·학명이 서류와 맞지 않습니다. 연결 항목을 확인해 주세요.');
    for (const entry of entries) {
      const count = linked.filter(animal => matches(entry, animal)).length;
      const used = doc.quantityChanges.filter(change => normalize(change.species) === normalize(entry.species)).reduce((sum, change) => sum + Number(change.count || 0), 0);
      if (entry.count < Math.max(count, used)) throw new Error(`${entry.species}: 연결 동물 ${count}마리 또는 감소 기록 ${used}마리보다 수량을 줄일 수 없습니다.`);
      const added = linked.filter(animal => matches(entry, animal) && !(previous?.animalIds || []).includes(animal.id)).length;
      if (added > entry.count - used) throw new Error(`${entry.species}: 남은 수량을 초과하여 새 동물을 연결할 수 없습니다.`);
    }
    if (doc.quantityChanges.some(change => change.species && !entries.some(entry => normalize(entry.species) === normalize(change.species)))) throw new Error('양도·폐사 기록이 있는 종명은 삭제하거나 변경할 수 없습니다.');
    doc.initialCount = entries.reduce((sum, entry) => sum + entry.count, 0);
    if (doc.initialCount < Math.max(linked.length, doc.quantityChanges.reduce((sum, change) => sum + Number(change.count || 0), 0))) throw new Error('전체 관리 수량이 연결 동물 또는 감소 기록보다 작습니다.');
    const added = linked.filter(animal => !(previous?.animalIds || []).includes(animal.id)).length;
    if (added > doc.initialCount - doc.quantityChanges.reduce((sum, change) => sum + Number(change.count || 0), 0)) throw new Error('남은 전체 수량을 초과하여 연결할 수 없습니다.');
    doc.species = entries.map(entry => entry.species).join(', ');
    write({ 'cites-documents':editing ? documents.map(item => item.id === doc.id ? doc : item) : [doc, ...documents] });
  }
  function deleteDocument(id) {
    const documents = read('cites-documents');
    const doc = documents.find(doc => doc.id === id);
    if (!doc) return;
    if (!isEvent(doc) && documents.some(item => (item.effects || []).some(effect => effect.sourceDocumentIds?.includes(id)))) throw new Error('양도·폐사 서류에서 사용 중인 원본 서류입니다. 관련 처리 서류를 먼저 정리해 주세요.');
    const animals = read('cites-animals');
    if (isEvent(doc)) {
      for (const effect of doc.effects || []) {
        const animal = animals.find(animal => animal.id === effect.animalId);
        if (animal?.statusDocumentId === id) { animal.status = effect.previousStatus; delete animal.statusDocumentId; }
      }
      documents.forEach(source => { source.quantityChanges = (source.quantityChanges || []).filter(change => change.eventDocumentId !== id); });
    }
    write({ 'cites-documents':documents.filter(item => item.id !== id), ...(isEvent(doc) ? {'cites-animals':animals} : {}) });
  }
  function cancelManualChange(documentId, index, expected) {
    const documents = read('cites-documents');
    const doc = documents.find(item => item.id === documentId);
    const change = doc?.quantityChanges?.[index];
    if (!change || JSON.stringify(change) !== expected) throw new Error('감소 내역이 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
    if (change.eventDocumentId) throw new Error('자동 처리 내역은 연결된 양도·폐사 서류에서 되돌려 주세요.');
    doc.cancelledQuantityChanges = [...(doc.cancelledQuantityChanges || []), {...change, cancelledAt:new Date().toISOString()}];
    doc.quantityChanges.splice(index, 1);
    write({'cites-documents':documents});
  }
  function deleteAnimal(id) {
    write({
      'cites-documents':read('cites-documents').map(doc => ({ ...doc, animalIds:(doc.animalIds || []).filter(animalId => animalId !== id) })),
      'cites-breeding-records':read('cites-breeding-records').filter(record => record.animalId !== id),
      'cites-animals':read('cites-animals').filter(animal => animal.id !== id)
    });
  }
  window.CitesRecords = { saveDocument, deleteDocument, cancelManualChange, deleteAnimal, isEvent, eventSpecies };
})();
