function observeConnection(socket, onChange, warningDelay = 3000) {
  let timer = null;
  let disposed = false;
  let warning = false;
  const connected = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    warning = false;
    if (!disposed) onChange({ connected: true, warning: false });
  };
  const disconnected = () => {
    if (disposed) return;
    onChange({ connected: false, warning });
    // Repeated connection errors must not restart the grace period indefinitely.
    if (!warning && timer === null)
      timer = setTimeout(() => {
        timer = null;
        if (!disposed && !socket.connected) {
          warning = true;
          onChange({ connected: false, warning: true });
        }
      }, warningDelay);
  };
  const failed = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    warning = true;
    if (!disposed) onChange({ connected: false, warning: true });
  };
  socket.on("connect", connected);
  socket.on("disconnect", disconnected);
  socket.on("connect_error", disconnected);
  socket.io.on("reconnect_failed", failed);
  if (socket.connected) connected();
  else disconnected();
  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    socket.off("connect", connected);
    socket.off("disconnect", disconnected);
    socket.off("connect_error", disconnected);
    socket.io.off("reconnect_failed", failed);
  };
}

module.exports = { observeConnection };
