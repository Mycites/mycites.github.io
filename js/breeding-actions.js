document.addEventListener('click', event => {
  const deleteRecord = event.target.closest('[data-delete-record]');
  if (deleteRecord) {
    if (!confirm('이 증식 기록과 기록에 첨부한 사진을 삭제할까요? 부모 개체와 개체 사진은 유지됩니다. Google Calendar·Drive 백업은 별도로 삭제해 주세요.')) return;
    const records = JSON.parse(CitesStorage.getItem('cites-breeding-records') || '[]');
    try { CitesStorage.setItem('cites-breeding-records', JSON.stringify(records.filter(record => record.id !== deleteRecord.dataset.deleteRecord))); }
    catch { alert('삭제를 저장하지 못했습니다. 다시 시도해 주세요.'); return; }
    location.reload();
    return;
  }
  const deleteHatch = event.target.closest('[data-delete-hatch]');
  if (deleteHatch) {
    if (!confirm('이 부화 기록을 삭제할까요? 함께 첨부한 사진도 삭제됩니다.')) return;
    const records = JSON.parse(CitesStorage.getItem('cites-breeding-records') || '[]');
    const record = records.find(item => item.id === deleteHatch.dataset.recordId);
    if (!record) { alert('기록을 찾을 수 없습니다. 새로고침해 주세요.'); return; }
    record.hatchLogs = (record.hatchLogs || []).filter(hatch => hatch.id !== deleteHatch.dataset.deleteHatch);
    try { CitesStorage.setItem('cites-breeding-records', JSON.stringify(records)); }
    catch { alert('삭제를 저장하지 못했습니다. 다시 시도해 주세요.'); return; }
    location.reload();
  }
});
