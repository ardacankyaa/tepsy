const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { observeConnection } = require("../src/lib/socket-connection.cjs");

function fakeSocket(connected = true) {
  const socket = new EventEmitter();
  socket.connected = connected;
  socket.io = new EventEmitter();
  return socket;
}

test("temporary disconnect gets a delayed warning while retries continue indefinitely", async () => {
  const socket = fakeSocket();
  let latest;
  const dispose = observeConnection(
    socket,
    (state) => {
      latest = state;
    },
    10
  );
  assert.deepEqual(latest, { connected: true, warning: false });
  socket.connected = false;
  socket.emit("disconnect", "transport close");
  assert.deepEqual(latest, { connected: false, warning: false });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(latest, { connected: false, warning: true });
  socket.connected = true;
  socket.emit("connect");
  assert.deepEqual(latest, { connected: true, warning: false });
  dispose();
});

test("short initial connection failures recover without a stale warning timer", async () => {
  const socket = fakeSocket(false);
  let latest;
  const dispose = observeConnection(
    socket,
    (state) => {
      latest = state;
    },
    10
  );
  socket.emit("connect_error", new Error("unavailable"));
  socket.connected = true;
  socket.emit("connect");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(latest, { connected: true, warning: false });
  dispose();
});

test("disposing observer removes listeners and does not update an unmounted view", async () => {
  const socket = fakeSocket(false);
  const history = [];
  const dispose = observeConnection(socket, (state) => history.push(state), 10);
  dispose();
  await new Promise((resolve) => setTimeout(resolve, 25));
  socket.emit("connect");
  socket.io.emit("reconnect_failed");
  assert.equal(history.length, 1);
  assert.equal(socket.listenerCount("connect"), 0);
  assert.equal(socket.listenerCount("disconnect"), 0);
  assert.equal(socket.listenerCount("connect_error"), 0);
  assert.equal(socket.io.listenerCount("reconnect_failed"), 0);
});
