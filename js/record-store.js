(() => {
  const read = key => JSON.parse(localStorage.getItem(key) || '[]');
  const normalize = value => String(value || '').replace(/\s/g, '').toLowerCase();
  const matches = (entry, animal) => entry.scientificName && animal.scientificName
    ? normalize(entry.scientificName) === normalize(animal.scientificName)
    : normalize(entry.species) === normalize(animal.species);
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
    if (!doc.title.trim()) throw new Error('서류 이름을 입력해 주세요.');
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
    write({ 'cites-documents':read('cites-documents').filter(doc => doc.id !== id) });
  }
  function deleteAnimal(id) {
    write({
      'cites-documents':read('cites-documents').map(doc => ({ ...doc, animalIds:(doc.animalIds || []).filter(animalId => animalId !== id) })),
      'cites-breeding-records':read('cites-breeding-records').filter(record => record.animalId !== id),
      'cites-animals':read('cites-animals').filter(animal => animal.id !== id)
    });
  }
  window.CitesRecords = { saveDocument, deleteDocument, deleteAnimal };
})();
