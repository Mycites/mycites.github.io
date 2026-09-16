(() => {
  const CLIENT_ID = '815518831853-jm9apbu6j94cndmvqpk28i879mor0v91.apps.googleusercontent.com';
  const SYNC_SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events';
  const SPREADSHEET_NAME = '사이테스 기록장 데이터';
  const sheetSpecs = [
    { title:'개체', key:'cites-animals', headers:['id','category','species','name','status','sex','date','memo','drivePhotoId','drivePhotoUrl','createdAt'] },
    { title:'서류', key:'cites-documents', headers:['id','title','species','initialCount','quantityChanges','reference','animalIds','fileName','driveFileId','driveFileUrl','createdAt'] },
    { title:'증식기록', key:'cites-breeding-records', headers:['id','animalId','type','laidAt','hatchedAt','temperature','eggs','hatchlings','memo','photoName','drivePhotoId','drivePhotoUrl','createdAt'] }
  ];
  const transferKeys = ['cites-animals', 'cites-documents', 'cites-breeding-records'];
  let accessToken = '';
  let tokenClient;
  const byId = id => document.querySelector(`#${id}`);
  const setStatus = message => { const status = byId('sync-status'); if (status) status.textContent = message; };
  const setBusy = (button, busy) => { if (button) button.disabled = busy; };
  const api = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json', ...(options.headers || {}) } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || 'Google 요청에 실패했습니다.');
    return response.status === 204 ? null : response.json();
  };
  const localRows = spec => {
    const items = JSON.parse(localStorage.getItem(spec.key) || '[]');
    return [spec.headers, ...items.map(item => spec.headers.map(header => {
      const value = item[header];
      return Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : (value ?? '');
    }))];
  };
  const findOrCreateSpreadsheet = async () => {
    const query = encodeURIComponent(`name = '${SPREADSHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);
    const found = await api(`https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=10&fields=files(id,name)`);
    if (found.files?.length) return found.files[0].id;
    const created = await api('https://sheets.googleapis.com/v4/spreadsheets', { method:'POST', body:JSON.stringify({ properties:{ title:SPREADSHEET_NAME }, sheets:sheetSpecs.map(spec => ({ properties:{ title:spec.title } })) }) });
    return created.spreadsheetId;
  };
  const safeName = value => String(value || '파일').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const dataUrlToBlob = dataUrl => {
    const [header, encoded] = dataUrl.split(',');
    const mimeType = header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
    const binary = atob(encoded || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type:mimeType });
  };
  const findOrCreateDriveFolder = async () => {
    const query = encodeURIComponent("name = '사이테스 기록장 파일' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const found = await api(`https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=10&fields=files(id,name)`);
    if (found.files?.length) return found.files[0].id;
    const created = await api('https://www.googleapis.com/drive/v3/files?fields=id', { method:'POST', body:JSON.stringify({ name:'사이테스 기록장 파일', mimeType:'application/vnd.google-apps.folder' }) });
    return created.id;
  };
  const uploadDataUrl = async (dataUrl, name, folderId) => {
    const boundary = `cites_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const file = dataUrlToBlob(dataUrl);
    const metadata = JSON.stringify({ name, parents:[folderId] });
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`, file, `\r\n--${boundary}--`], { type:`multipart/related; boundary=${boundary}` });
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method:'POST', headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':`multipart/related; boundary=${boundary}` }, body });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || 'Drive 파일 업로드에 실패했습니다.');
    return response.json();
  };
  const backupDriveFiles = async () => {
    const button = byId('google-drive'); setBusy(button, true); setStatus('Google Drive에 사진과 서류를 백업하는 중입니다…');
    try {
      const folderId = await findOrCreateDriveFolder();
      const animals = JSON.parse(localStorage.getItem('cites-animals') || '[]');
      const documents = JSON.parse(localStorage.getItem('cites-documents') || '[]');
      const breedingRecords = JSON.parse(localStorage.getItem('cites-breeding-records') || '[]');
      let uploaded = 0;
      for (const animal of animals) {
        if (!animal.photo || animal.drivePhotoId) continue;
        const file = await uploadDataUrl(animal.photo, `개체_${safeName(animal.name)}_${animal.id}.jpg`, folderId);
        animal.drivePhotoId = file.id; animal.drivePhotoUrl = file.webViewLink || `https://drive.google.com/open?id=${file.id}`; uploaded += 1;
      }
      for (const document of documents) {
        if (!document.fileData || document.driveFileId) continue;
        const file = await uploadDataUrl(document.fileData, safeName(document.fileName || `${document.title}.pdf`), folderId);
        document.driveFileId = file.id; document.driveFileUrl = file.webViewLink || `https://drive.google.com/open?id=${file.id}`; uploaded += 1;
      }
      for (const record of breedingRecords) {
        if (!record.photo || record.drivePhotoId) continue;
        const file = await uploadDataUrl(record.photo, `증식_${safeName(record.type || '기록')}_${record.id}.jpg`, folderId);
        record.drivePhotoId = file.id; record.drivePhotoUrl = file.webViewLink || `https://drive.google.com/open?id=${file.id}`; uploaded += 1;
      }
      localStorage.setItem('cites-animals', JSON.stringify(animals));
      localStorage.setItem('cites-documents', JSON.stringify(documents));
      localStorage.setItem('cites-breeding-records', JSON.stringify(breedingRecords));
      await backup();
      setStatus(uploaded ? `${uploaded}개 파일을 Drive에 백업하고 Sheets 기록도 갱신했습니다.` : '새로 올릴 파일은 없으며 Sheets 기록을 갱신했습니다.');
    } catch (error) { setStatus(`Drive 백업하지 못했습니다: ${error.message}`); }
    finally { setBusy(button, false); }
  };
  const backup = async () => {
    const button = byId('google-sync'); setBusy(button, true); setStatus('Google Sheets에 기록을 저장하는 중입니다…');
    try {
      const spreadsheetId = await findOrCreateSpreadsheet();
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, { method:'POST', body:JSON.stringify({ ranges:sheetSpecs.map(spec => `'${spec.title}'!A:Z`) }) });
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, { method:'POST', body:JSON.stringify({ valueInputOption:'RAW', data:sheetSpecs.map(spec => ({ range:`'${spec.title}'!A1`, majorDimension:'ROWS', values:localRows(spec) })) }) });
      localStorage.setItem('cites-google-sheet-id', spreadsheetId);
      setStatus('방금 Google Sheets에 관리 기록을 백업했습니다.');
    } catch (error) { setStatus(`백업하지 못했습니다: ${error.message}`); }
    finally { setBusy(button, false); }
  };
  const parseRows = (spec, values, localItems) => {
    if (!values?.length) return [];
    const headers = values[0];
    const existing = new Map(localItems.map(item => [item.id, item]));
    return values.slice(1).filter(row => row.some(value => value !== '')).map(row => {
      const item = {};
      headers.forEach((header, index) => {
        let value = row[index] ?? '';
        if (header === 'animalIds' || header === 'quantityChanges') { try { value = value ? JSON.parse(value) : []; } catch { value = []; } }
        if (header === 'initialCount') value = Number(value || 0);
        item[header] = value;
      });
      const current = existing.get(item.id);
      if (current?.photo) item.photo = current.photo;
      if (current?.fileData) item.fileData = current.fileData;
      return item;
    });
  };
  const restore = async () => {
    if (!confirm('현재 기기의 텍스트 기록을 Google Sheets 기록으로 바꿉니다. 이 기기에만 있는 사진·파일은 유지하지만, 먼저 백업하는 것을 권장합니다. 계속할까요?')) return;
    const button = byId('google-restore'); setBusy(button, true); setStatus('Google Sheets에서 기록을 불러오는 중입니다…');
    try {
      const spreadsheetId = await findOrCreateSpreadsheet();
      const ranges = sheetSpecs.map(spec => encodeURIComponent(`'${spec.title}'!A:Z`)).join('&ranges=');
      const result = await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?ranges=${ranges}`);
      sheetSpecs.forEach((spec, index) => {
        const current = JSON.parse(localStorage.getItem(spec.key) || '[]');
        localStorage.setItem(spec.key, JSON.stringify(parseRows(spec, result.valueRanges?.[index]?.values, current)));
      });
      localStorage.setItem('cites-google-sheet-id', spreadsheetId);
      setStatus('Google Sheets 기록을 불러왔습니다. 화면을 새로 고칩니다.');
      setTimeout(() => location.reload(), 700);
    } catch (error) { setStatus(`불러오지 못했습니다: ${error.message}`); setBusy(button, false); }
  };
  const showConnected = () => {
    byId('google-connect').hidden = true;
    byId('google-sync').hidden = false;
    byId('google-drive').hidden = false;
    byId('google-restore').hidden = false;
    setStatus('Google 계정이 연결되었습니다. 필요한 항목을 백업할 수 있습니다.');
  };
  const requestAccess = callback => {
    const request = prompt => {
      tokenClient.callback = response => {
        if (response.error) {
          if (prompt === '' && ['interaction_required', 'consent_required'].includes(response.error)) { request('consent'); return; }
          setStatus('Google 연결이 취소되었거나 허용되지 않았습니다.'); return;
        }
        accessToken = response.access_token; showConnected(); callback?.();
      };
      tokenClient.requestAccessToken({ prompt });
    };
    request('');
  };
  const setCalendarMessage = message => { const target = byId('calendar-message'); if (target) target.textContent = message; };
  const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
  const renderCalendarEvents = () => {
    const list = JSON.parse(localStorage.getItem('cites-calendar-events') || '[]').sort((a, b) => a.date.localeCompare(b.date));
    const target = byId('calendar-list');
    const empty = byId('calendar-empty');
    if (!target || !empty) return;
    empty.hidden = list.length > 0;
    target.innerHTML = list.slice(0, 4).map(event => `<div class="calendar-record"><div class="record"><span class="record-icon">📅</span><div><b>${escapeHtml(event.kind)} · ${escapeHtml(event.title)}</b><span>${escapeHtml(event.date)}${event.note ? ` · ${escapeHtml(event.note)}` : ''}</span></div></div><button class="calendar-delete" type="button" data-calendar-id="${escapeHtml(event.id)}">삭제</button></div>`).join('');
    target.querySelectorAll('[data-calendar-id]').forEach(button => button.addEventListener('click', () => deleteCalendarEvent(button.dataset.calendarId)));
  };
  const nextDay = value => {
    const date = new Date(`${value}T00:00:00`); date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const createCalendarEvent = async () => {
    const form = byId('calendar-form');
    const title = byId('calendar-title').value.trim();
    const date = byId('calendar-date').value;
    if (!title || !date) { setCalendarMessage('일정 제목과 날짜를 입력해 주세요.'); return; }
    try {
      setCalendarMessage('Google Calendar에 일정을 추가하는 중입니다…');
      const kind = byId('calendar-kind').value;
      const note = byId('calendar-note').value.trim();
      const created = await api('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method:'POST', body:JSON.stringify({ summary:`[사이테스 기록장] ${kind}: ${title}`, description:note, start:{ date }, end:{ date:nextDay(date) } }) });
      const events = JSON.parse(localStorage.getItem('cites-calendar-events') || '[]');
      events.push({ id:created.id, kind, title, date, note });
      localStorage.setItem('cites-calendar-events', JSON.stringify(events));
      renderCalendarEvents();
      form.reset(); form.classList.remove('open'); setCalendarMessage('Google Calendar에 일정이 추가되었습니다.');
    } catch (error) { setCalendarMessage(`일정을 추가하지 못했습니다: ${error.message}`); }
  };
  const requestCalendarAccess = () => {
    if (!tokenClient) { setCalendarMessage('Google 로그인 준비가 끝날 때까지 잠시 기다려 주세요.'); return; }
    if (accessToken) { createCalendarEvent(); return; }
    requestAccess(createCalendarEvent);
  };
  const deleteCalendarEvent = eventId => {
    if (!confirm('이 일정을 Google Calendar와 기록장에서 삭제할까요?')) return;
    const removeFromList = message => {
      const events = JSON.parse(localStorage.getItem('cites-calendar-events') || '[]').filter(event => event.id !== eventId);
      localStorage.setItem('cites-calendar-events', JSON.stringify(events));
      renderCalendarEvents(); setCalendarMessage(message);
    };
    const remove = async () => {
      try {
        if (eventId) await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method:'DELETE' });
        removeFromList('일정을 삭제했습니다.');
      } catch (error) {
        if (/resource has been deleted|not found|404|410/i.test(error.message)) { removeFromList('Google Calendar에서 이미 삭제된 일정이라 앱 목록에서 정리했습니다.'); return; }
        setCalendarMessage(`일정을 삭제하지 못했습니다: ${error.message}`);
      }
    };
    if (accessToken) { remove(); return; }
    requestAccess(remove);
  };
  const setupCalendar = () => {
    const form = byId('calendar-form');
    byId('calendar-toggle').addEventListener('click', () => form.classList.add('open'));
    byId('calendar-cancel').addEventListener('click', () => { form.reset(); form.classList.remove('open'); });
    form.addEventListener('submit', event => { event.preventDefault(); requestCalendarAccess(); });
  };
  const exportData = () => {
    const data = { format:'cites-backup-v1', exportedAt:new Date().toISOString(), records:Object.fromEntries(transferKeys.map(key => [key, JSON.parse(localStorage.getItem(key) || '[]')])) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `사이테스-기록-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus('기록 파일을 내려받았습니다. 이 파일은 안전한 곳에 보관해 주세요.');
  };
  const importData = event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.format !== 'cites-backup-v1' || !data.records || !transferKeys.every(key => Array.isArray(data.records[key]))) throw new Error('사이테스 기록 파일 형식이 아닙니다.');
        if (!confirm('현재 화면의 기록을 선택한 파일의 기록으로 바꿉니다. 현재 기록은 먼저 파일로 내보낸 뒤 진행하세요. 계속할까요?')) return;
        const previous = Object.fromEntries(transferKeys.map(key => [key, localStorage.getItem(key)]));
        try { transferKeys.forEach(key => localStorage.setItem(key, JSON.stringify(data.records[key]))); }
        catch (error) { transferKeys.forEach(key => previous[key] === null ? localStorage.removeItem(key) : localStorage.setItem(key, previous[key])); throw error; }
        setStatus('기록 파일을 가져왔습니다. 화면을 새로 고칩니다.');
        setTimeout(() => location.reload(), 700);
      } catch (error) { setStatus(`가져오지 못했습니다: ${error.message}`); }
      finally { event.target.value = ''; }
    });
    reader.readAsText(file);
  };
  const setupTransfer = () => {
    byId('export-data').addEventListener('click', exportData);
    byId('import-file').addEventListener('change', importData);
  };
  setupTransfer();
  setupCalendar();
  renderCalendarEvents();
  window.googleIdentityReady = () => {
    const connect = byId('google-connect');
    const sync = byId('google-sync');
    const drive = byId('google-drive');
    const restoreButton = byId('google-restore');
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id:CLIENT_ID, scope:SYNC_SCOPES, callback:'' });
    connect.disabled = false; connect.textContent = 'Google 계정 연결';
    connect.addEventListener('click', () => requestAccess());
    sync.addEventListener('click', () => requestAccess(backup));
    drive.addEventListener('click', () => requestAccess(backupDriveFiles));
    restoreButton.addEventListener('click', () => requestAccess(restore));
  };
})();
