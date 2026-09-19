// The account shell keeps the active account's records separate from legacy PC data.
window.CitesStorage = {
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key),
};
window.CitesAccountMode = false;
try {
  if (window.parent !== window && window.parent.location.origin === location.origin && window.parent.CitesAccountStorage) {
    window.CitesStorage = window.parent.CitesAccountStorage;
    window.CitesAccountMode = true;
  }
} catch { /* Direct/local mode remains available. */ }
