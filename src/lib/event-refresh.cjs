function createDebouncedRefresh(callback, delay = 150) {
  let timer = null;
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, delay);
  };
  refresh.dispose = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return refresh;
}

module.exports = { createDebouncedRefresh };
