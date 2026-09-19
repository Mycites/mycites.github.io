// Provider-independent migration package. This module never changes local storage.
(function (root) {
  const keys = ['cites-animals', 'cites-documents', 'cites-breeding-records', 'cites-shared-photos', 'cites-calendar-events'];
  async function pack(storage) {
    const assets = new Map();
    async function visit(value) {
      if (typeof value === 'string' && /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(value)) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        assets.set(id, value);
        return {citesAsset:id};
      }
      if (Array.isArray(value)) return Promise.all(value.map(visit));
      if (value && typeof value === 'object') {
        const output = {};
        for (const [key, child] of Object.entries(value)) output[key] = await visit(child);
        return output;
      }
      return value;
    }
    const records = {};
    for (const key of keys) {
      const value = JSON.parse(storage.getItem(key) || '[]');
      if (!Array.isArray(value)) throw new Error('기록 형식을 확인해 주세요: ' + key);
      records[key] = await visit(value);
    }
    return {format:'cites-cloud-v1', records, assets:Object.fromEntries(assets)};
  }
  async function unpack(bundle) {
    if (bundle?.format !== 'cites-cloud-v1' || !bundle.assets || !keys.every(key => Array.isArray(bundle.records?.[key]))) throw new Error('계정 기록 형식이 올바르지 않습니다.');
    const verified = new Map();
    async function visit(value) {
      if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.citesAsset === 'string') {
        const id = value.citesAsset, data = bundle.assets[id];
        if (typeof data !== 'string') throw new Error('첨부파일이 누락되었습니다.');
        if (!verified.has(id)) {
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
          if (Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') !== id) throw new Error('첨부파일 검증에 실패했습니다.');
          verified.set(id, data);
        }
        return data;
      }
      if (Array.isArray(value)) return Promise.all(value.map(visit));
      if (value && typeof value === 'object') {
        const output = {};
        for (const [key, child] of Object.entries(value)) output[key] = await visit(child);
        return output;
      }
      return value;
    }
    return visit(bundle.records);
  }
  root.CitesCloudPackage = {pack, unpack, keys};
})(typeof window === 'undefined' ? globalThis : window);
