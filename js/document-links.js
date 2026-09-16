(() => {
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const sameSpecies = (a, b) => normalize(a).replaceAll(' ', '') === normalize(b).replaceAll(' ', '');
  function candidates(scientificName, documents, animals) {
    if (!normalize(scientificName)) return [];
    return documents.flatMap(doc => {
      const entries = doc.speciesEntries?.length ? doc.speciesEntries : [{ ...doc, count:doc.initialCount }];
      const matches = entries.filter(entry => normalize(entry.scientificName) === normalize(scientificName));
      if (!matches.length) return [];
      const count = matches.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
      const used = (doc.quantityChanges || []).filter(change => matches.some(entry => sameSpecies(entry.species, change.species)))
        .reduce((sum, change) => sum + Number(change.count || 0), 0);
      const ids = new Set(doc.animalIds || []);
      const linked = animals.filter(animal => ids.has(animal.id) &&
        (normalize(animal.scientificName) === normalize(scientificName) ||
          (!animal.scientificName && matches.some(entry => sameSpecies(entry.species, animal.species))))).length;
      // Linked animals remain part of the original allocation even after transfer.
      const totalRemaining = Number(doc.initialCount ?? count) - (doc.quantityChanges || []).reduce((sum, change) => sum + Number(change.count || 0), 0);
      const slots = Math.max(0, Math.min(count - linked, count - used, totalRemaining));
      return [{ document:doc, slots, linked }];
    });
  }
  function saveAnimal(animal, documentIds) {
    const oldAnimals = localStorage.getItem('cites-animals');
    const oldDocuments = localStorage.getItem('cites-documents');
    const animals = JSON.parse(oldAnimals || '[]');
    const documents = JSON.parse(oldDocuments || '[]');
    const available = candidates(animal.scientificName, documents, animals);
    const selected = [...new Set(documentIds)];
    selected.forEach(id => {
      const match = available.find(item => item.document.id === id);
      if (!match || match.slots < 1) throw new Error('선택한 서류의 학명이나 수량이 변경되었습니다. 서류 후보를 다시 확인해 주세요.');
      match.document.animalIds = [...new Set([...(match.document.animalIds || []), animal.id])];
    });
    let documentsWritten = false;
    try {
      if (selected.length) {
        localStorage.setItem('cites-documents', JSON.stringify(documents));
        documentsWritten = true;
      }
      localStorage.setItem('cites-animals', JSON.stringify([animal, ...animals]));
    } catch (error) {
      if (documentsWritten) {
        if (oldDocuments === null) localStorage.removeItem('cites-documents');
        else localStorage.setItem('cites-documents', oldDocuments);
      }
      throw new Error('저장 공간이 부족하거나 저장할 수 없습니다. 사진 용량을 줄인 뒤 다시 시도해 주세요.', { cause:error });
    }
  }
  window.CitesDocumentLinks = { candidates, saveAnimal };
})();
