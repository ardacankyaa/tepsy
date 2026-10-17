"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { observeConnection } from "@/lib/socket-connection.cjs";

let socketInstance = null;

export function getSocket() {
  if (!socketInstance && typeof window !== "undefined") {
    socketInstance = io({
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.3,
    });
  }
  return socketInstance;
}

export function useSocket() {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnectFailed, setIsReconnectFailed] = useState(false);

  useEffect(() => {
    const s = getSocket();
    setSocket(s);

    if (s)
      return observeConnection(s, ({ connected, warning }) => {
        setIsConnected(connected);
        setIsReconnectFailed(warning);
      });
  }, []);

  return { socket, isConnected, isReconnectFailed };
}
