const assert = require('node:assert/strict');
require('../js/cloud-package.js');
(async () => {
  const photo = 'data:image/png;base64,YQ==';
  const source = Object.fromEntries(CitesCloudPackage.keys.map(key => [key, []]));
  source['cites-animals'] = [{id:'one', photo}, {id:'two', photo}];
  source['cites-documents'] = [{id:'doc', fileData:photo}];
  const storage = {getItem:key => JSON.stringify(source[key])};
  const bundle = await CitesCloudPackage.pack(storage);
  assert.equal(Object.keys(bundle.assets).length, 1);
  assert.deepEqual(await CitesCloudPackage.unpack(bundle), source);
  const damaged = structuredClone(bundle);
  damaged.assets[Object.keys(damaged.assets)[0]] = 'changed';
  await assert.rejects(CitesCloudPackage.unpack(damaged), /검증/);
  const missing = structuredClone(bundle); missing.assets = {};
  await assert.rejects(CitesCloudPackage.unpack(missing), /누락/);
  assert.equal(source['cites-animals'][0].photo, photo);
  console.log('PASS unique attachment, round trip, corruption/missing rejection, original preserved');
})().catch(error => {console.error(error); process.exitCode = 1;});
