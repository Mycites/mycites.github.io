(() => {
  function mount(container, animals, motherId = '', fatherId = '') {
    container.classList.add('parent-picker');
    if (!document.getElementById('parent-picker-style')) {
      const style = document.createElement('style'); style.id = 'parent-picker-style';
      style.textContent = '.parent-picker{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;width:100%;min-width:0}.parent-choice{display:grid;grid-template-columns:minmax(0,1fr) 90px;grid-template-rows:auto 80px;gap:8px 12px;min-width:0;align-items:center}.parent-choice>label{grid-column:1/-1;margin:0;font-size:.88rem}.parent-choice>select{width:100%;min-width:0;max-width:100%;margin:0;height:46px;text-overflow:ellipsis}.parent-preview{width:90px;height:80px;display:grid;place-items:center;text-align:center;font-size:.75rem;border:1px solid #bcd6c9;border-radius:10px;overflow:hidden}.parent-preview img{display:block;max-width:100%;max-height:100%;object-fit:contain}@media(max-width:680px){.parent-picker{grid-template-columns:minmax(0,1fr)}}';
      document.head.append(style);
    }
    const choices = {};
    for (const [key, title, excluded, initial] of [['mother','모개체 (암컷·미상)','수컷',motherId], ['father','부개체 (수컷·미상, 선택)','암컷',fatherId]]) {
      const box = document.createElement('div'); box.className = 'parent-choice';
      const label = document.createElement('label'); label.textContent = title;
      const select = document.createElement('select'); select.id = 'parent-' + key; select.required = key === 'mother'; select.style.maxWidth = '100%'; label.htmlFor = select.id;
      select.add(new Option(key === 'mother' ? '모개체 선택' : '미상 / 선택 안 함',''));
      animals.filter(animal => animal.sex !== excluded && !['양도 완료','폐사'].includes(animal.status)).forEach(animal => select.add(new Option(animal.name + ' · ' + animal.species, animal.id)));
      select.value = initial;
      const preview = document.createElement('div'); preview.className = 'parent-preview';
      const update = () => { preview.replaceChildren(); const animal = animals.find(item => item.id === select.value); if (choices.mother && choices.father) choices.father.setCustomValidity(choices.father.value && choices.father.value === choices.mother.value ? '모개체와 부개체는 서로 달라야 합니다.' : ''); if (!animal) { preview.textContent = '사진 미리보기'; return; }
        const src = animal.photo || animal.photos?.find(photo => photo.type === '개체 사진' && photo.data)?.data;
        if (src) { const img = document.createElement('img'); img.src = src; img.alt = animal.name + ' 사진';  preview.append(img); } else preview.textContent = '등록 사진 없음';
        if (choices.mother && choices.father) choices.father.setCustomValidity(choices.father.value && choices.father.value === choices.mother.value ? '모개체와 부개체는 서로 달라야 합니다.' : '');
      };
      choices[key] = select; select.addEventListener('change', update); box.append(label, select, preview); container.append(box); update();
    }
    return {values:() => ({motherId:choices.mother.value, fatherId:choices.father.value})};
  }
  window.CitesParents = {mount};
})();
