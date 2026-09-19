document.addEventListener('click', event => {
  const button = event.target.closest('[data-delete-record]');
  if (!button) return;
  if (!confirm('이 증식 기록과 기록에 첨부한 사진을 삭제할까요? 부모 개체와 개체 사진은 유지됩니다. Google Calendar·Drive 백업은 별도로 삭제해 주세요.')) return;
  const records = JSON.parse(CitesStorage.getItem('cites-breeding-records') || '[]');
  try { CitesStorage.setItem('cites-breeding-records', JSON.stringify(records.filter(record => record.id !== button.dataset.deleteRecord))); }
  catch { alert('삭제를 저장하지 못했습니다. 다시 시도해 주세요.'); return; }
  location.reload();
});
