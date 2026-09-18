(() => {
  function mount(container, animals, motherId = '', fatherId = '') {
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:18px;width:100%';
    const choices = {};
    for (const [key, title, excluded, initial] of [['mother','모개체 (암컷·미상)','수컷',motherId], ['father','부개체 (수컷·미상, 선택)','암컷',fatherId]]) {
      const box = document.createElement('div'); box.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:10px;min-width:0;flex:1 1 280px';
      const label = document.createElement('label'); label.textContent = title;
      const select = document.createElement('select'); select.id = 'parent-' + key; select.required = key === 'mother'; select.style.maxWidth = '100%'; label.htmlFor = select.id;
      select.add(new Option(key === 'mother' ? '모개체 선택' : '미상 / 선택 안 함',''));
      animals.filter(animal => animal.sex !== excluded && !['양도 완료','폐사'].includes(animal.status)).forEach(animal => select.add(new Option(animal.name + ' · ' + animal.species, animal.id)));
      select.value = initial;
      const preview = document.createElement('div'); preview.style.cssText = 'width:100px;min-height:75px;font-size:.8rem';
      const update = () => { preview.replaceChildren(); const animal = animals.find(item => item.id === select.value); if (choices.mother && choices.father) choices.father.setCustomValidity(choices.father.value && choices.father.value === choices.mother.value ? '모개체와 부개체는 서로 달라야 합니다.' : ''); if (!animal) return;
        const src = animal.photo || animal.photos?.find(photo => photo.type === '개체 사진' && photo.data)?.data;
        if (src) { const img = document.createElement('img'); img.src = src; img.alt = animal.name + ' 사진'; img.style.cssText = 'width:100px;height:75px;object-fit:contain;border-radius:8px'; preview.append(img); } else preview.textContent = '등록 사진 없음';
        if (choices.mother && choices.father) choices.father.setCustomValidity(choices.father.value && choices.father.value === choices.mother.value ? '모개체와 부개체는 서로 달라야 합니다.' : '');
      };
      choices[key] = select; select.addEventListener('change', update); box.append(label, select, preview); container.append(box); update();
    }
    return {values:() => ({motherId:choices.mother.value, fatherId:choices.father.value})};
  }
  window.CitesParents = {mount};
})();
