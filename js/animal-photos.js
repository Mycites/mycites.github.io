(() => {
  const image = (src, name) => { const img = document.createElement('img'); img.src = src; img.alt = name; img.style.cssText = 'display:block;width:180px;max-width:100%;height:130px;object-fit:contain;border-radius:10px;background:#edf4ef;margin:10px 0'; return img; };
  async function read(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG·PNG·WebP 사진을 선택해 주세요.');
    if (file.size > 1024 * 1024) throw new Error('사진은 1MB 이하로 선택해 주세요.');
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.')); reader.readAsDataURL(file); });
    const img = new Image(); img.src = data;
    try { await img.decode(); } catch { throw new Error('열 수 없는 사진 파일입니다.'); }
    return data;
  }
  const libraryKey = 'cites-shared-photos';
  const library = () => JSON.parse(localStorage.getItem(libraryKey) || '[]');
  const resolve = photos => (photos || []).map(photo => photo.data ? {...photo} : {...library().find(item => item.id === photo.id), ...photo}).filter(photo => photo.data);
  function compact(animals, existing = library()) {
    const pool = existing.map(photo => ({...photo}));
    const records = animals.map(animal => ({...animal, photos:(animal.photos || []).map(photo => {
      if (photo.type !== '사육환경 사진' || !photo.data) return photo;
      let stored = pool.find(item => item.data === photo.data);
      if (!stored) { stored = {...photo, id:pool.some(item => item.id === photo.id) ? crypto.randomUUID() : photo.id}; pool.push(stored); }
      return {id:stored.id, type:photo.type, name:photo.name};
    })}));
    return {animals:records, photos:pool};
  }
  function migrate() {
    const old = localStorage.getItem('cites-animals'); if (!old) return;
    const animals = JSON.parse(old); if (!animals.some(animal => animal.photos?.some(photo => photo.type === '사육환경 사진' && photo.data))) return;
    const result = compact(animals), previous = localStorage.getItem(libraryKey);
    try { localStorage.setItem(libraryKey, JSON.stringify(result.photos)); localStorage.setItem('cites-animals', JSON.stringify(result.animals)); }
    catch (error) { if (previous === null) localStorage.removeItem(libraryKey); else localStorage.setItem(libraryKey, previous); throw error; }
  }
  function gallery(container, animal) {
    const photos = [...(animal.photo ? [{data:animal.photo, name:animal.photoName || '대표 개체 사진', type:'개체 사진'}] : []), ...resolve(animal.photos)];
    if (!photos.length) { const text = document.createElement('p'); text.textContent = '등록된 사진이 없습니다. 정보 수정에서 추가하세요.'; container.append(text); }
    const grid = document.createElement('div'); grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:18px'; container.append(grid);
    photos.forEach(photo => { const card = document.createElement('div'); card.style.maxWidth = '100%'; const title = document.createElement('p'); title.textContent = `${photo.name} · ${photo.type}`; title.style.overflowWrap = 'anywhere'; const link = document.createElement('a'); link.href = photo.data; link.download = photo.name || '사진'; link.textContent = '내려받기'; card.append(image(photo.data, photo.name), title, link); grid.append(card); });
  }
  function editor(container, initial) {
    let photos = resolve(initial), busy = false;
    container.innerHTML = '<h3>추가 사진</h3><label>사진 종류<select data-kind><option>개체 사진</option><option>사육환경 사진</option></select></label><label>사진 이름<input data-name placeholder="예: 거실 사육장 전체"></label><label>사진 추가 (1MB 이하)<input data-file type="file" accept="image/jpeg,image/png,image/webp"></label><p data-message role="status"></p><div data-selected></div><h3>등록된 사육환경 사진에서 선택</h3><div data-shared></div>';
    const list = container.querySelector('[data-selected]'), message = container.querySelector('[data-message]');
    const shared = library();
    function render() {
      list.replaceChildren();
      photos.forEach(photo => { const card = document.createElement('div'); const name = document.createElement('input'); name.value = photo.name; name.setAttribute('aria-label', '사진 이름 수정'); name.addEventListener('input', () => photo.name = name.value); const kind = document.createElement('p'); kind.textContent = photo.type; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '연결 해제'; remove.addEventListener('click', () => { photos = photos.filter(item => item.id !== photo.id); render(); }); card.append(image(photo.data, photo.name), kind, name, remove); list.append(card); });
      const pool = container.querySelector('[data-shared]'); pool.replaceChildren();
      if (!shared.length) pool.textContent = '아직 등록된 사육환경 사진이 없습니다. 위에서 추가한 뒤 동물을 저장하면 다른 동물에서도 선택할 수 있어요.';
      shared.forEach(photo => { const label = document.createElement('label'); const check = document.createElement('input'); check.type = 'checkbox'; check.style.width = 'auto'; check.checked = photos.some(item => item.id === photo.id); check.addEventListener('change', () => { if (check.checked) photos.push({...photo}); else photos = photos.filter(item => item.id !== photo.id); render(); }); label.append(check, document.createTextNode(photo.name), image(photo.data, photo.name)); pool.append(label); });
    }
    container.querySelector('[data-file]').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return; busy = true; event.target.disabled = true; message.textContent = '사진을 읽고 있습니다…';
      const type = container.querySelector('[data-kind]').value, name = container.querySelector('[data-name]').value.trim() || file.name.replace(/\.[^.]+$/, '');
      try { const data = await read(file); photos.push({id:crypto.randomUUID(), name, type, data}); render(); message.textContent = '사진 추가 완료 · 마지막 단계에서 저장해 주세요.'; }
      catch (error) { message.textContent = error.message; }
      finally { busy = false; event.target.disabled = false; event.target.value = ''; }
    });
    render(); return {values:() => photos.map(photo => ({...photo, name:photo.name.trim() || photo.type})), loading:() => busy};
  }
  window.CitesPhotos = {image, read, gallery, editor, compact, migrate};
  try { migrate(); } catch { alert("공유 사진 정리를 저장하지 못했습니다. 기존 사진은 유지됩니다. 저장 공간을 확인해 주세요."); }
})();
