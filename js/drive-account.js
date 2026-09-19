(() => {
  const CLIENT_ID = '815518831853-jm9apbu6j94cndmvqpk28i879mor0v91.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
  const apiRoot = 'https://www.googleapis.com/drive/v3/files';
  const $ = id => document.getElementById(id);
  let token = '', expires = 0, userId = '', tokenClient, state = {}, base = '', dirty = false, busy = false, timer, epoch = 0, locked = true;
  let pendingLogin = null;
  const assetFiles = new Map();
  const keys = CitesCloudPackage.keys;
  const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
  const storage = {
    getItem:key => state[key] ?? null,
    setItem(key, value) {
      if (state[key] === String(value)) return;
      state[key] = String(value);
      if (keys.includes(key)) { dirty = true; epoch++; status('계정에 저장 대기 중…'); clearTimeout(timer); timer = setTimeout(save, 1200); }
    },
    removeItem(key) { if (!(key in state)) return; delete state[key]; if (keys.includes(key)) { dirty = true; epoch++; clearTimeout(timer); timer = setTimeout(save, 1200); status('계정에 저장 대기 중…'); } }
  };
  window.CitesAccountStorage = storage;
  async function request(url, options = {}) {
    if (!token || Date.now() >= expires) throw new Error('로그인 연결이 만료되었습니다. Google 계정으로 다시 연결해 주세요.');
    const response = await fetch(url, {...options, headers:{Authorization:'Bearer ' + token, ...options.headers}});
    if (!response.ok) {
      if (response.status === 401) expires = 0;
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error?.message || 'Google Drive 요청 실패 (' + response.status + ')');
    }
    return response;
  }
  async function list(type) {
    const files = []; let page = '';
    do {
      const q = "trashed = false and appProperties has { key='citesApp' and value='account-v1' } and appProperties has { key='citesType' and value='" + type + "' }";
      const params = new URLSearchParams({q, fields:'nextPageToken,files(id,name,createdTime,appProperties)', pageSize:'1000'}); if (page) params.set('pageToken', page);
      const result = await (await request(apiRoot + '?' + params)).json(); files.push(...(result.files || [])); page = result.nextPageToken || '';
    } while (page);
    return files;
  }
  const heads = files => { const referenced = new Set(files.flatMap(file => (file.appProperties?.parents || '').split(',').filter(Boolean))); return files.filter(file => !referenced.has(file.id)); };
  async function create(name, type, content, extra = {}) {
    const metadata = {name, mimeType:content.type || 'application/json', appProperties:{citesApp:'account-v1', citesType:type, ...extra}};
    const boundary = 'cites_' + crypto.randomUUID();
    const body = new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify(metadata), '\r\n--'+boundary+'\r\nContent-Type: '+metadata.mimeType+'\r\n\r\n',content,'\r\n--'+boundary+'--'],{type:'multipart/related; boundary='+boundary});
    return (await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {method:'POST',body})).json();
  }
  function showWorkspace() {
    $('welcome').hidden = true; $('workspace').hidden = false; $('tools').hidden = false;
    $('save').hidden = false; $('reload').hidden = false; $('logout').hidden = false;
    if (!$('workspace').getAttribute('src')) $('workspace').src = 'index.html?account=1'; else $('workspace').contentWindow.location.replace('index.html?account=1');
  }
  async function openSnapshot(file) {
    const manifest = await (await request(apiRoot+'/'+encodeURIComponent(file.id)+'?alt=media')).json();
    if (manifest.owner !== userId || manifest.format !== 'cites-drive-v1') throw new Error('이 계정의 기록 파일이 아닙니다.');
    const assets = {};
    for (const [hash, asset] of Object.entries(manifest.assets || {})) {
      const blob = await (await request(apiRoot+'/'+encodeURIComponent(asset.fileId)+'?alt=media')).blob();
      assets[hash] = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(new Blob([blob],{type:asset.mime})); });
      assetFiles.set(hash, asset);
    }
    const records = await CitesCloudPackage.unpack({format:'cites-cloud-v1', records:manifest.records, assets});
    state = Object.fromEntries(keys.map(key => [key,JSON.stringify(records[key])])); base = file.id; dirty = false; locked = false; $('conflicts').hidden = true; showWorkspace(); status('계정 기록을 불러왔습니다.');
  }
  async function load() {
    locked = true; status('계정 기록을 불러오는 중…');
    const tips = heads(await list('snapshot'));
    if (tips.length > 1) { showConflict(tips); return; }
    if (tips.length === 1) await openSnapshot(tips[0]);
    else { state = {}; base = ''; dirty = false; locked = false; showWorkspace(); status('빈 계정입니다. 기존 PC 기록을 가져오거나 새로 등록하세요.'); }
  }
  function showConflict(tips) {
    locked = true; $('conflicts').hidden = false; $('conflicts').replaceChildren();
    const text = document.createElement('p'); text.textContent = '여러 기기에서 따로 저장한 기록이 있습니다. 원본은 모두 보관되었습니다. 현재 미저장 기록이 있다면 먼저 내려받으세요. 사용할 기록을 선택하면 해당 기록을 기준으로 통합합니다.'; $('conflicts').append(text);
    for (const file of tips) {
      const button = document.createElement('button'); button.textContent = new Date(file.createdTime).toLocaleString() + ' 기록 선택';
      button.onclick = async () => { if (!confirm('선택한 기록을 기준으로 사용할까요? 다른 버전은 Drive에 보관됩니다.')) return; try { await openSnapshot(file); mergeParents = tips.map(tip=>tip.id); dirty = true; epoch++; await save(); } catch(error) { status(error.message,true); } };
      $('conflicts').append(button);
    }
    status('동시 변경을 발견했습니다. 사용할 기록을 선택해 주세요.',true);
  }
  let mergeParents = null;
  async function save() {
    if (busy || !dirty) return;
    if (locked || !token || Date.now() >= expires) { clearTimeout(timer); timer = setTimeout(save, 1200); return; }
    busy = true; $('save').disabled = true; const currentEpoch = epoch;
    try {
      status('계정에 저장 중…');
      const currentHeads = heads(await list('snapshot'));
      const expected = mergeParents || (base ? [base] : []);
      if (currentHeads.map(file=>file.id).sort().join(',') !== [...expected].sort().join(',')) { locked = true; status('다른 기기에서 기록이 변경되었습니다. 현재 기록을 내려받은 뒤 최신 기록을 불러와 주세요.',true); return; }
      const snapshot = {...state};
      const bundle = await CitesCloudPackage.pack({getItem:key=>snapshot[key] ?? null});
      const assets = {};
      for (const [hash,data] of Object.entries(bundle.assets)) {
        if (!assetFiles.has(hash)) {
          const blob = await (await fetch(data)).blob(); const result = await create('사이테스_첨부_'+hash.slice(0,16), 'asset', blob,{hash});
          assetFiles.set(hash,{fileId:result.id,mime:blob.type});
        }
        assets[hash] = assetFiles.get(hash);
      }
      // Immutable revisions prevent one device from overwriting another device's data.
      const manifest = {format:'cites-drive-v1',owner:userId,records:bundle.records,assets};
      const result = await create('사이테스 기록_'+new Date().toISOString()+'.json','snapshot',new Blob([JSON.stringify(manifest)],{type:'application/json'}),{parents:expected.join(',')});
      base = result.id; mergeParents = null; dirty = epoch !== currentEpoch;
      const tips = heads(await list('snapshot'));
      if (tips.length > 1) { showConflict(tips); return; }
      status(dirty ? '추가 변경 저장 대기 중…' : '계정에 저장 완료');
    } catch(error) { status('저장하지 못했습니다: '+error.message+' · 현재 기록은 내려받기로 보관할 수 있습니다.',true); }
    finally { busy = false; $('save').disabled = false; if (dirty) { clearTimeout(timer); timer = setTimeout(save,1200); } }
  }
  function exportRecords() {
    const data = {format:'cites-backup-v1',exportedAt:new Date().toISOString(),records:Object.fromEntries(keys.map(key=>[key,JSON.parse(state[key] || '[]')]))};
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})); const link = document.createElement('a'); link.href = url; link.download = '사이테스-계정기록.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('save').onclick = save;
  $('export').onclick = exportRecords;
  $('reload').onclick = async () => { if (busy) return; if (dirty && !confirm('저장하지 않은 변경이 있습니다. 내려받기로 보관했나요? 계정의 최신 기록으로 바꿀까요?')) return; try { await load(); } catch(error) { status(error.message,true); } };
  $('migrate').onclick = async () => {
    if (busy || locked) return;
    if (keys.some(key=>JSON.parse(state[key] || '[]').length)) { status('기존 계정 기록을 보호하기 위해 빈 계정에서만 PC 기록을 가져올 수 있습니다.',true); return; }
    if (!confirm($('identity').textContent+' 계정으로 이 기기의 동물·서류·사진·증식 기록을 가져올까요? PC 원본은 유지됩니다.')) return;
    try { const bundle = await CitesCloudPackage.pack(localStorage); const records = await CitesCloudPackage.unpack(bundle); state = Object.fromEntries(keys.map(key=>[key,JSON.stringify(records[key])])); dirty = true; epoch++; showWorkspace(); await save(); } catch(error) { status(error.message,true); }
  };
  $('logout').onclick = () => {
    if (busy) { status('저장이 끝난 뒤 로그아웃해 주세요.',true); return; }
    if (dirty && !confirm('계정에 저장되지 않은 변경이 있습니다. 기록을 내려받았나요? 로그아웃하면 이 변경은 사라집니다.')) return;
    clearTimeout(timer); token='';expires=0;userId='';state={};base='';dirty=false;locked=true;assetFiles.clear();mergeParents=null;
    $('workspace').removeAttribute('src');$('workspace').hidden=true;$('welcome').hidden=false;$('tools').hidden=true;$('conflicts').hidden=true;$('identity').textContent='';
    ['save','reload','logout'].forEach(id=>$(id).hidden=true); status('로그아웃했습니다.');
  };
  window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
  window.citesAccountReady = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPES,callback:async response=>{
      if (response.error) { status('Google 연결에 실패했습니다: '+response.error,true); return; }
      try {
        const nextToken = response.access_token;
        const identityResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+nextToken}});
        if (!identityResponse.ok) throw new Error('계정을 확인하지 못했습니다.');
        const identity = await identityResponse.json(); if (!identity.sub) throw new Error('계정 식별 정보가 없습니다.');
        if (userId && identity.sub !== userId) throw new Error('현재 계정과 다릅니다. 먼저 현재 기록을 저장하고 로그아웃해 주세요.');
        token=nextToken; expires=Date.now()+Math.max(0,Number(response.expires_in)-30)*1000;
        const reconnect = userId === identity.sub; userId=identity.sub;$('identity').textContent=identity.email || 'Google 계정';
        localStorage.setItem('cites-account-preferred','1');
        if (reconnect && dirty) { locked=false;await save(); } else await load();
      } catch(error) {status(error.message,true);}
    },error_callback:()=>status('로그인 창이 닫혔거나 열리지 않았습니다. 다시 눌러 주세요.',true)});
    $('login').disabled=false; status('Google 계정으로 로그인해 주세요.');
    $('login').onclick=()=>{if(busy)return;tokenClient.requestAccessToken({prompt:userId?'':'select_account'});};
  };
})();
