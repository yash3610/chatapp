import { createContext, useContext, useEffect, useMemo } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const { token, isAuthenticated } = useAuth();
  const socket = useMemo(() => {
    if (!isAuthenticated || !token) {
      return null;
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
    const nextSocket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.3,
      timeout: 20000,
      withCredentials: true,
    });

    // Keep auth token fresh for reconnect attempts.
    nextSocket.on('reconnect_attempt', () => {
      nextSocket.auth = { token };
    });

    // If server intentionally disconnects, reconnect explicitly.
    nextSocket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        nextSocket.connect();
      }
    });

    nextSocket.on('connect_error', () => {
      nextSocket.auth = { token };
    });

    return nextSocket;
  }, [isAuthenticated, token]);

  useEffect(() => {
    return () => {
      socket?.disconnect();
    };
  }, [socket]);

  const value = useMemo(() => ({ socket }), [socket]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used inside SocketProvider');
  }
  return context;
};
