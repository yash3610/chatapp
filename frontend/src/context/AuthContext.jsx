import { createContext, useContext, useState } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(localStorage.getItem('chat_token'));
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('chat_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const saveSession = (nextToken, nextUser) => {
    localStorage.setItem('chat_token', nextToken);
    localStorage.setItem('chat_user', JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  };

  const clearSession = () => {
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_user');
    setToken(null);
    setUser(null);
  };

  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    saveSession(data.token, data.user);
  };

  const login = async (payload) => {
    const { data } = await api.post('/auth/login', payload);
    saveSession(data.token, data.user);
  };

  const logout = () => {
    clearSession();
  };

  const updateUser = (nextUser) => {
    const merged = { ...user, ...nextUser };
    localStorage.setItem('chat_user', JSON.stringify(merged));
    setUser(merged);
  };

  const value = {
    token,
    user,
    isAuthenticated: Boolean(token && user),
    register,
    login,
    logout,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
};
