import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';
import ChatWindow from '../components/ChatWindow';
import CallOverlay from '../components/CallOverlay';
import IncomingCallModal from '../components/IncomingCallModal';
import MessageInput from '../components/MessageInput';
import OutgoingCallModal from '../components/OutgoingCallModal';
import Sidebar from '../components/Sidebar';
import ToastStack from '../components/ToastStack';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

const mergeUniqueMessages = (firstBatch, secondBatch) => {
  const map = new Map();
  [...firstBatch, ...secondBatch].forEach((message) => {
    map.set(message._id, message);
  });

  return Array.from(map.values()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
};

const appendUniqueMessage = (currentMessages, nextMessage) => {
  if (!nextMessage?._id) {
    return [...currentMessages, nextMessage];
  }

  if (currentMessages.some((message) => String(message._id) === String(nextMessage._id))) {
    return currentMessages;
  }

  return [...currentMessages, nextMessage];
};

const upsertMessage = (currentMessages, nextMessage) => {
  if (!nextMessage?._id) {
    return currentMessages;
  }

  const exists = currentMessages.some((message) => String(message._id) === String(nextMessage._id));

  if (!exists) {
    return [...currentMessages, nextMessage].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  return currentMessages.map((message) =>
    String(message._id) === String(nextMessage._id)
      ? {
          ...message,
          ...nextMessage,
        }
      : message
  );
};

const createClientMessageId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const waitForSocketConnect = (socket, timeoutMs = 6000) => {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Socket unavailable'));
      return;
    }

    if (socket.connected) {
      resolve();
      return;
    }

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Socket connection timed out'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
    };

    if (!socket.connected) {
      socket.connect();
    }

    socket.on('connect', onConnect);
  });
};

const ChatDashboard = () => {
  const { user, logout, updateUser } = useAuth();
  const { socket } = useSocket();
  const zegoAppId = import.meta.env.VITE_ZEGO_APP_ID;
  const zegoServerSecret = import.meta.env.VITE_ZEGO_SERVER_SECRET;

  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [discoverUsers, setDiscoverUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [theme, setTheme] = useState(localStorage.getItem('chat_theme') || 'light');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState('');
  const [isDownloadingPreview, setIsDownloadingPreview] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [activeCall, setActiveCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCall, setOutgoingCall] = useState(null);
  const [replyContext, setReplyContext] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);

  const messagesEndRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const backupToastAtRef = useRef(0);
  const typingResetTimerRef = useRef(null);
  const typingSentRef = useRef(false);
  const callTimeoutRef = useRef(null);
  const ringtoneIntervalRef = useRef(null);
  const audioContextRef = useRef(null);

  const selectedUserId = selectedUser?._id;
  const isGroupChat = Boolean(selectedUser?.isGroup);
  const canDirectChat = useMemo(() => {
    if (!selectedUser || selectedUser.isGroup) {
      return true;
    }
    return users.some((person) => String(person._id) === String(selectedUser._id));
  }, [selectedUser, users]);

  const getDirectCallRoomId = (firstId, secondId) => {
    return [String(firstId), String(secondId)].sort().join('__');
  };

  const addToast = (message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3200);
  };

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const stopRingtone = useCallback(() => {
    if (ringtoneIntervalRef.current) {
      window.clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(() => {
    stopRingtone();

    const playTone = () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new window.AudioContext();
        }

        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(920, ctx.currentTime);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.24);
      } catch {
        // Ignore ringtone API failures (browser autoplay restrictions).
      }
    };

    playTone();
    ringtoneIntervalRef.current = window.setInterval(playTone, 1100);
  }, [stopRingtone]);

  const clearCallTimeout = useCallback(() => {
    if (callTimeoutRef.current) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearCallTimeout();
      stopRingtone();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [clearCallTimeout, stopRingtone]);

  const endCurrentCall = () => {
    setActiveCall((prev) => {
      if (prev && socket) {
        socket.emit('call_end', {
          to: prev.peerId,
          roomId: prev.roomId,
          callType: prev.callType,
        });
      }
      return null;
    });
    stopRingtone();
    clearCallTimeout();
    setIncomingCall(null);
    setOutgoingCall(null);
  };

  const cancelOutgoingCall = () => {
    setOutgoingCall((prev) => {
      if (prev && socket) {
        socket.emit('call_cancel', {
          to: prev.peerId,
          roomId: prev.roomId,
          reason: 'cancelled',
          callType: prev.callType,
        });
      }
      return null;
    });
    clearCallTimeout();
  };

  const rejectIncomingCall = () => {
    setIncomingCall((prev) => {
      if (prev && socket) {
        socket.emit('call_reject', {
          to: prev.callerId,
          roomId: prev.roomId,
          reason: 'declined',
          callType: prev.callType,
        });
      }
      return null;
    });
    stopRingtone();
  };

  const acceptIncomingCall = () => {
    setIncomingCall((prev) => {
      if (!prev) {
        return prev;
      }

      if (socket) {
        socket.emit('call_accept', {
          to: prev.callerId,
          roomId: prev.roomId,
          callType: prev.callType,
        });
      }

      setActiveCall({
        roomId: prev.roomId,
        callType: prev.callType,
        peerId: prev.callerId,
        peerName: prev.callerName,
      });
      return null;
    });

    stopRingtone();
  };

  const startCall = (callType) => {
    if (!selectedUser || !socket || isGroupChat || !canDirectChat) {
      return;
    }

    if (!zegoAppId || !zegoServerSecret) {
      addToast('Calling is not configured. Add ZEGO keys in frontend .env.', 'error');
      return;
    }

    const roomId = getDirectCallRoomId(user.id, selectedUser._id);
    setOutgoingCall({
      roomId,
      callType,
      peerId: String(selectedUser._id),
      peerName: selectedUser.name,
      statusText: 'Calling...',
      showCancel: true,
    });

    clearCallTimeout();
    callTimeoutRef.current = window.setTimeout(() => {
      setOutgoingCall((prev) => {
        if (!prev || prev.roomId !== roomId) {
          return prev;
        }

        if (socket) {
          socket.emit('call_cancel', {
            to: prev.peerId,
            roomId,
            reason: 'timeout',
            callType: prev.callType,
          });
        }

        addToast('No answer. Call timed out.', 'info');
        return {
          ...prev,
          statusText: 'No answer',
          showCancel: false,
        };
      });

      window.setTimeout(() => {
        setOutgoingCall((prev) => (prev?.roomId === roomId ? null : prev));
      }, 1800);
    }, 30000);

    socket.emit('call_invite', {
      to: String(selectedUser._id),
      roomId,
      callType,
      callerName: user.name,
      callerAvatar: user.avatarUrl || '',
    });
  };

  const handleSelectUser = (nextUser) => {
    setSelectedUser(nextUser ? { ...nextUser, isGroup: false } : null);
    setIsTyping(false);
    typingSentRef.current = false;
  };

  const handleSelectGroup = (nextGroup) => {
    setSelectedUser(nextGroup ? { ...nextGroup, isGroup: true } : null);
    setIsTyping(false);
    typingSentRef.current = false;
  };

  const moveUserToTop = (userId) => {
    if (!userId) {
      return;
    }

    setUsers((prevUsers) => {
      const index = prevUsers.findIndex((person) => String(person._id) === String(userId));
      if (index <= 0) {
        return prevUsers;
      }

      const nextUsers = [...prevUsers];
      const [targetUser] = nextUsers.splice(index, 1);
      nextUsers.unshift(targetUser);
      return nextUsers;
    });
  };

  const moveGroupToTop = (groupId) => {
    if (!groupId) {
      return;
    }

    setGroups((prevGroups) => {
      const index = prevGroups.findIndex((group) => String(group._id) === String(groupId));
      if (index <= 0) {
        return prevGroups;
      }

      const nextGroups = [...prevGroups];
      const [targetGroup] = nextGroups.splice(index, 1);
      nextGroups.unshift(targetGroup);
      return nextGroups;
    });
  };

  const handleCreateGroup = async ({ name, memberIds }) => {
    try {
      const { data } = await api.post('/groups', {
        name,
        members: memberIds,
      });

      const normalized = {
        ...data,
        isGroup: true,
        memberCount: data.members?.length || 0,
      };

      setGroups((prev) => [normalized, ...prev.filter((group) => String(group._id) !== String(normalized._id))]);
      setSelectedUser(normalized);
      addToast('Group created successfully.', 'success');
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to create group';
      addToast(message, 'error');
      throw err;
    }
  };

  const applyTheme = (nextTheme) => {
    setTheme(nextTheme);
    localStorage.setItem('chat_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const toggleTheme = () => {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const getDownloadFileName = (imageUrl) => {
    try {
      const url = new URL(imageUrl);
      const pathname = url.pathname || '';
      const rawName = pathname.split('/').pop() || 'chat-image';
      const cleanName = rawName.split('?')[0] || 'chat-image';
      return cleanName.includes('.') ? cleanName : `${cleanName}.jpg`;
    } catch {
      return `chat-image-${Date.now()}.jpg`;
    }
  };

  const handleDownloadPreview = async () => {
    if (!previewImageUrl || isDownloadingPreview) {
      return;
    }

    try {
      setIsDownloadingPreview(true);
      const response = await fetch(previewImageUrl, { mode: 'cors' });
      if (!response.ok) {
        throw new Error('Download failed');
      }

      const fileBlob = await response.blob();
      const objectUrl = URL.createObjectURL(fileBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = getDownloadFileName(previewImageUrl);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      addToast('Unable to download image right now.', 'error');
    } finally {
      setIsDownloadingPreview(false);
    }
  };

  const handleEditProfile = async ({ name, avatarFile, removeAvatar = false }) => {
    const trimmedName = name?.trim() || '';
    const isNameChanged = trimmedName && trimmedName !== user.name;
    const hasAvatarFile = Boolean(avatarFile);
    const hasAvatarRemoval = Boolean(removeAvatar);
    const hasAvatarChange = hasAvatarFile || hasAvatarRemoval;

    if (!isNameChanged && !hasAvatarChange) {
      return;
    }

    try {
      let nextAvatarUrl = user.avatarUrl || '';

      if (hasAvatarFile) {
        const uploadData = new FormData();
        uploadData.append('avatar', avatarFile);
        const uploaded = await api.post('/users/avatar', uploadData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        nextAvatarUrl = uploaded.data.avatarUrl || '';
      } else if (hasAvatarRemoval) {
        nextAvatarUrl = '';
      }

      const payload = {};
      if (isNameChanged) {
        payload.name = trimmedName;
      }
      if (hasAvatarChange) {
        payload.avatarUrl = nextAvatarUrl;
      }

      const { data } = await api.patch('/users/me', payload);
      updateUser({
        id: data.id,
        name: data.name,
        email: data.email,
        avatarUrl: data.avatarUrl || '',
      });
      setUsers((prev) =>
        prev.map((person) =>
          String(person._id) === String(data.id)
            ? { ...person, name: data.name, avatarUrl: data.avatarUrl || '' }
            : person
        )
      );
      setSelectedUser((prev) => {
        if (!prev || String(prev._id) !== String(data.id)) {
          return prev;
        }
        return {
          ...prev,
          name: data.name,
          avatarUrl: data.avatarUrl || '',
        };
      });
      addToast('Profile updated successfully.', 'success');
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to update profile';
      setError(message);
      addToast(message, 'error');
      throw err;
    }
  };

  useEffect(() => {
    applyTheme(theme);
  }, []);

  useEffect(() => {
    if (!previewImageUrl) {
      return undefined;
    }

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setPreviewImageUrl('');
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [previewImageUrl]);

  useEffect(() => {
    return () => {
      if (typingResetTimerRef.current) {
        window.clearTimeout(typingResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const markConversationSeen = async (withUserId) => {
    if (!withUserId) {
      return;
    }

    socket?.emit('mark_seen', { withUserId });

    try {
      await api.patch(`/messages/seen/${withUserId}`);
    } catch {
      // Socket event remains the primary realtime path; API call is fallback persistence.
    }
  };

  const clearComposerContext = () => {
    setReplyContext(null);
    setEditingMessage(null);
  };

  const fetchConversation = async (chatUserId, before = null) => {
    const params = { limit: 25 };
    if (before) {
      params.before = before;
    }

    const url = isGroupChat ? `/messages/group/${chatUserId}` : `/messages/${chatUserId}`;
    const { data } = await api.get(url, { params });
    return data;
  };

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/users');
      setUsers(data);
      setSelectedUser((prev) => {
        if (prev) {
          if (prev.isGroup) {
            return prev;
          }
          return data.find((person) => person._id === prev._id) || null;
        }
        return data[0] || null;
      });
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to fetch contacts';
      setError(message);
      addToast(message, 'error');
    }
  };

  const fetchContactRequests = async () => {
    try {
      const { data } = await api.get('/users/requests');
      setIncomingRequests(data?.incoming || []);
      setOutgoingRequests(data?.outgoing || []);
    } catch {
      setIncomingRequests([]);
      setOutgoingRequests([]);
    }
  };

  const fetchDiscoverUsers = async () => {
    try {
      const { data } = await api.get('/users/discover');
      setDiscoverUsers(data || []);
    } catch {
      setDiscoverUsers([]);
    }
  };

  const refreshContactData = async ({ includeContacts = true } = {}) => {
    const tasks = [fetchContactRequests(), fetchDiscoverUsers()];
    if (includeContacts) {
      tasks.push(fetchUsers());
    }
    await Promise.all(tasks);
  };

  const handleSendRequest = async (receiverId) => {
    if (!receiverId) {
      return;
    }

    try {
      await api.post('/users/requests', { receiverId });
      addToast('Contact request sent.', 'success');
      await refreshContactData({ includeContacts: false });
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to send request';
      addToast(message, 'error');
    }
  };

  const handleRespondRequest = async (requestId, action) => {
    if (!requestId || !action) {
      return;
    }

    try {
      await api.patch(`/users/requests/${requestId}`, { action });
      addToast(action === 'accepted' ? 'Contact request accepted.' : 'Contact request rejected.', 'success');
      await refreshContactData({ includeContacts: action === 'accepted' });
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to update request';
      addToast(message, 'error');
    }
  };

  useEffect(() => {
    refreshContactData();
  }, []);

  const fetchGroups = async () => {
    try {
      const { data } = await api.get('/groups');
      const normalized = (data || []).map((group) => ({
        ...group,
        isGroup: true,
        memberCount: group.members?.length || 0,
      }));
      setGroups(normalized);

      setSelectedUser((prev) => {
        if (!prev || !prev.isGroup) {
          return prev;
        }
        return normalized.find((group) => String(group._id) === String(prev._id)) || null;
      });
    } catch {
      // Keep private chat usable even if groups endpoint fails.
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  useEffect(() => {
    if (!selectedUserId || (!isGroupChat && !canDirectChat)) {
      setMessages([]);
      setHasMore(false);
      setNextCursor(null);
      setIsTyping(false);
      clearComposerContext();
      typingSentRef.current = false;
      return;
    }

    setIsTyping(false);
    typingSentRef.current = false;

    const fetchConversation = async () => {
      try {
        const data = await api.get(isGroupChat ? `/messages/group/${selectedUserId}` : `/messages/${selectedUserId}`, {
          params: { limit: 25 },
        });
        setMessages(data.data.messages || []);
        setHasMore(data.data.hasMore);
        setNextCursor(data.data.nextCursor);
        setUnreadCounts((prev) => ({ ...prev, [selectedUserId]: 0 }));
        if (!isGroupChat) {
          await markConversationSeen(selectedUserId);
        }
      } catch (err) {
        const message = err.response?.data?.message || 'Failed to fetch messages';
        setError(message);
        addToast(message, 'error');
      }
    };

    fetchConversation();
  }, [selectedUserId, isGroupChat, canDirectChat]);

  useEffect(() => {
    if (!selectedUserId || isGroupChat || !canDirectChat) {
      return undefined;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const { data } = await api.get(`/messages/typing-status/${selectedUserId}`);
        setIsTyping(Boolean(data?.isTyping));
      } catch {
        // Silent fallback check.
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedUserId, isGroupChat, canDirectChat]);

  useEffect(() => {
    if (!selectedUserId || (!isGroupChat && !canDirectChat)) {
      return undefined;
    }

    const intervalId = window.setInterval(async () => {
      if (socket?.connected) {
        return;
      }

      try {
        const latest = await fetchConversation(selectedUserId);
        setMessages((prev) => mergeUniqueMessages(prev, latest.messages || []));
      } catch {
        // Silent fallback polling; visible errors are handled by primary paths.
      }
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedUserId, socket, isGroupChat, canDirectChat]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleIncomingMessage = (message) => {
      if (message?.isGroup) {
        const groupId = String(message.chatId || '');
        const activeGroupId = isGroupChat ? String(selectedUserId || '') : '';

        moveGroupToTop(groupId);

        if (groupId && groupId === activeGroupId) {
          shouldAutoScrollRef.current = true;
          setMessages((prev) => appendUniqueMessage(prev, message));
        } else if (groupId && String(message.sender?._id || message.sender) !== String(user.id)) {
          setUnreadCounts((prev) => ({
            ...prev,
            [groupId]: (prev[groupId] || 0) + 1,
          }));
        }

        return;
      }

      const senderId = String(message.sender?._id || message.sender);
      const receiverId = String(message.receiver?._id || message.receiver);
      const currentUserId = String(user.id);
      const activeUserId = String(selectedUserId || '');
      const otherUserId = senderId === currentUserId ? receiverId : senderId;

      moveUserToTop(otherUserId);

      // Keep message list focused on the currently opened one-to-one conversation.
      const belongsToActiveThread =
        (senderId === currentUserId && receiverId === activeUserId) ||
        (senderId === activeUserId && receiverId === currentUserId);

      if (belongsToActiveThread) {
        shouldAutoScrollRef.current = true;
        setMessages((prev) => appendUniqueMessage(prev, message));

        if (senderId === activeUserId) {
          markConversationSeen(activeUserId);
        }
      } else if (receiverId === currentUserId && senderId !== currentUserId) {
        setUnreadCounts((prev) => ({
          ...prev,
          [senderId]: (prev[senderId] || 0) + 1,
        }));

        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(message.sender?.name || 'New message', {
            body: message.text || 'Sent you an image',
          });
        }
      }
    };

    const handleTyping = ({ from, isTyping: nextTyping }) => {
      if (isGroupChat) {
        return;
      }

      if (String(from) === String(selectedUserId)) {
        setIsTyping(nextTyping);

        if (typingResetTimerRef.current) {
          window.clearTimeout(typingResetTimerRef.current);
        }

        if (nextTyping) {
          // Hide stale typing indicator automatically if stop event is missed.
          typingResetTimerRef.current = window.setTimeout(() => {
            setIsTyping(false);
          }, 2200);
        }
      }
    };

    const handleOnlineUsers = (onlineUserIds) => {
      setUsers((prevUsers) =>
        prevUsers.map((person) => ({
          ...person,
          isOnline: onlineUserIds.includes(String(person._id)),
        }))
      );
      setSelectedUser((prevSelected) => {
        if (!prevSelected) {
          return prevSelected;
        }
        if (prevSelected.isGroup) {
          return prevSelected;
        }
        const isOnline = onlineUserIds.includes(String(prevSelected._id));
        return { ...prevSelected, isOnline };
      });
    };

    const handleGroupTyping = ({ groupId, from, isTyping: nextTyping }) => {
      if (!isGroupChat || String(groupId) !== String(selectedUserId) || String(from) === String(user.id)) {
        return;
      }

      setIsTyping(Boolean(nextTyping));

      if (typingResetTimerRef.current) {
        window.clearTimeout(typingResetTimerRef.current);
      }

      if (nextTyping) {
        typingResetTimerRef.current = window.setTimeout(() => {
          setIsTyping(false);
        }, 1800);
      }
    };

    const handleMessageStatusUpdate = ({ messageIds, status, deliveredAt, seenAt }) => {
      if (!messageIds?.length) {
        return;
      }

      setMessages((prevMessages) =>
        prevMessages.map((message) => {
          if (!messageIds.includes(String(message._id))) {
            return message;
          }

          return {
            ...message,
            status,
            deliveredAt: deliveredAt || message.deliveredAt,
            seenAt: seenAt || message.seenAt,
          };
        })
      );
    };

    const handleChatError = (payload) => {
      const message = payload?.message || 'Realtime chat error occurred';
      setError(message);
      addToast(message, 'error');
    };

    const refreshRequestState = async ({ includeContacts = false } = {}) => {
      try {
        const [requestsResponse, discoverResponse, contactsResponse] = await Promise.all([
          api.get('/users/requests'),
          api.get('/users/discover'),
          includeContacts ? api.get('/users') : Promise.resolve(null),
        ]);

        setIncomingRequests(requestsResponse.data?.incoming || []);
        setOutgoingRequests(requestsResponse.data?.outgoing || []);
        setDiscoverUsers(discoverResponse.data || []);

        if (contactsResponse?.data) {
          const contacts = contactsResponse.data;
          setUsers(contacts);
          setSelectedUser((prev) => {
            if (!prev || prev.isGroup) {
              return prev;
            }
            return contacts.find((person) => String(person._id) === String(prev._id)) || null;
          });
        }
      } catch {
        // Keep realtime resilient even if request refresh fails.
      }
    };

    const handleContactRequestNew = () => {
      refreshRequestState();
    };

    const handleContactRequestUpdated = ({ status }) => {
      refreshRequestState({ includeContacts: status === 'accepted' });
    };

    const handleContactRequestAccepted = () => {
      addToast('You are now connected. Start chatting.', 'success');
      refreshRequestState({ includeContacts: true });
    };

    const handleCallInvite = (payload) => {
      const fromId = String(payload?.callerId || payload?.from || '');
      const roomId = payload?.roomId;
      const callType = payload?.callType;

      if (!fromId || !roomId || !callType) {
        return;
      }

      if (activeCall || incomingCall) {
        socket.emit('call_reject', {
          to: fromId,
          roomId,
          reason: 'busy',
          callType,
        });
        return;
      }

      const caller = users.find((person) => String(person._id) === fromId);
      setIncomingCall({
        roomId,
        callType,
        callerId: fromId,
        callerName: payload?.callerName || caller?.name || 'Contact',
        callerAvatar: payload?.callerAvatar || caller?.avatarUrl || '',
      });
      startRingtone();
    };

    const handleCallAccept = ({ from, roomId, callType }) => {
      setOutgoingCall((prev) => {
        if (!prev || prev.roomId !== roomId || prev.peerId !== String(from)) {
          return prev;
        }

        clearCallTimeout();
        setActiveCall({
          roomId,
          callType,
          peerId: prev.peerId,
          peerName: prev.peerName,
        });

        return null;
      });
    };

    const handleCallReject = ({ from, roomId, reason }) => {
      setOutgoingCall((prev) => {
        if (!prev || prev.roomId !== roomId || prev.peerId !== String(from)) {
          return prev;
        }

        clearCallTimeout();
        const status = reason === 'busy' ? 'User is busy' : 'Call declined';
        addToast(status, 'info');
        return {
          ...prev,
          statusText: status,
          showCancel: false,
        };
      });

      window.setTimeout(() => {
        setOutgoingCall((prev) => (prev?.roomId === roomId ? null : prev));
      }, 1600);
    };

    const handleCallCancel = ({ roomId, reason }) => {
      setIncomingCall((prev) => {
        if (!prev || prev.roomId !== roomId) {
          return prev;
        }

        if (reason === 'timeout') {
          addToast('Missed call', 'info');
        }

        stopRingtone();
        return null;
      });
    };

    const handleCallEnd = ({ roomId }) => {
      setActiveCall((prev) => (prev?.roomId === roomId ? null : prev));
      setIncomingCall((prev) => (prev?.roomId === roomId ? null : prev));
      setOutgoingCall((prev) => (prev?.roomId === roomId ? null : prev));
      clearCallTimeout();
      stopRingtone();
    };

    const handleMessageReactionUpdate = (message) => {
      setMessages((prev) => upsertMessage(prev, message));
    };

    const handleMessageUpdated = (message) => {
      setMessages((prev) => upsertMessage(prev, message));
      if (editingMessage && String(editingMessage._id) === String(message._id)) {
        setEditingMessage(null);
      }
    };

    const handleMessageDeletedForEveryone = (message) => {
      setMessages((prev) => upsertMessage(prev, message));
      if (editingMessage && String(editingMessage._id) === String(message._id)) {
        setEditingMessage(null);
      }
      if (replyContext && String(replyContext._id) === String(message._id)) {
        setReplyContext(null);
      }
    };

    const handleMessageDeletedForMe = ({ messageId }) => {
      if (!messageId) {
        return;
      }
      setMessages((prev) => prev.filter((message) => String(message._id) !== String(messageId)));
      if (editingMessage && String(editingMessage._id) === String(messageId)) {
        setEditingMessage(null);
      }
      if (replyContext && String(replyContext._id) === String(messageId)) {
        setReplyContext(null);
      }
    };

    socket.on('receive_message', handleIncomingMessage);
    socket.on('typing', handleTyping);
    socket.on('group_typing', handleGroupTyping);
    socket.on('online_users', handleOnlineUsers);
    socket.on('message_status_update', handleMessageStatusUpdate);
    socket.on('chat_error', handleChatError);
    socket.on('call_invite', handleCallInvite);
    socket.on('call_accept', handleCallAccept);
    socket.on('call_reject', handleCallReject);
    socket.on('call_cancel', handleCallCancel);
    socket.on('call_end', handleCallEnd);
    socket.on('message_reaction_update', handleMessageReactionUpdate);
    socket.on('message_updated', handleMessageUpdated);
    socket.on('message_deleted_for_everyone', handleMessageDeletedForEveryone);
    socket.on('message_deleted_for_me', handleMessageDeletedForMe);
    socket.on('contact_request:new', handleContactRequestNew);
    socket.on('contact_request:updated', handleContactRequestUpdated);
    socket.on('contact_request:accepted', handleContactRequestAccepted);

    return () => {
      socket.off('receive_message', handleIncomingMessage);
      socket.off('typing', handleTyping);
      socket.off('group_typing', handleGroupTyping);
      socket.off('online_users', handleOnlineUsers);
      socket.off('message_status_update', handleMessageStatusUpdate);
      socket.off('chat_error', handleChatError);
      socket.off('call_invite', handleCallInvite);
      socket.off('call_accept', handleCallAccept);
      socket.off('call_reject', handleCallReject);
      socket.off('call_cancel', handleCallCancel);
      socket.off('call_end', handleCallEnd);
      socket.off('message_reaction_update', handleMessageReactionUpdate);
      socket.off('message_updated', handleMessageUpdated);
      socket.off('message_deleted_for_everyone', handleMessageDeletedForEveryone);
      socket.off('message_deleted_for_me', handleMessageDeletedForMe);
      socket.off('contact_request:new', handleContactRequestNew);
      socket.off('contact_request:updated', handleContactRequestUpdated);
      socket.off('contact_request:accepted', handleContactRequestAccepted);
    };
  }, [
    socket,
    selectedUserId,
    user.id,
    users,
    activeCall,
    incomingCall,
    clearCallTimeout,
    startRingtone,
    stopRingtone,
    editingMessage,
    replyContext,
    isGroupChat,
    canDirectChat,
  ]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const emitPrivateMessageWithAck = (payload) => {
    return new Promise((resolve, reject) => {
      if (!socket) {
        reject(new Error('Socket unavailable'));
        return;
      }

      socket.timeout(7000).emit('private_message', payload, (error, response) => {
        if (error) {
          reject(new Error('Socket timeout'));
          return;
        }

        if (!response?.ok || !response.message) {
          reject(new Error(response?.message || 'Socket ack failed'));
          return;
        }

        resolve(response.message);
      });
    });
  };

  const emitSocketAck = (eventName, payload, timeoutMs = 7000) => {
    return new Promise((resolve, reject) => {
      if (!socket) {
        reject(new Error('Socket unavailable'));
        return;
      }

      socket.timeout(timeoutMs).emit(eventName, payload, (error, response) => {
        if (error) {
          reject(new Error('Socket timeout'));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.message || 'Socket ack failed'));
          return;
        }

        resolve(response);
      });
    });
  };

  const sendMessage = async (text = '', imageFile = null, meta = {}) => {
    const trimmedText = text.trim();
    const editingMessageId = meta?.editingMessageId || null;
    const replyToId = meta?.replyToId || null;

    if (!selectedUserId || (!isGroupChat && !canDirectChat)) {
      if (!isGroupChat) {
        addToast('You can chat only with accepted contacts.', 'info');
      }
      return false;
    }

    if (editingMessageId) {
      if (!trimmedText) {
        return false;
      }

      if (socket?.connected) {
        try {
          const response = await emitSocketAck('message_edit', {
            messageId: editingMessageId,
            text: trimmedText,
          });
          if (response?.message) {
            setMessages((prev) => upsertMessage(prev, response.message));
            setEditingMessage(null);
            return true;
          }
        } catch {
          // Fallback to REST path.
        }
      }

      try {
        const { data } = await api.patch(`/messages/edit/${editingMessageId}`, { text: trimmedText });
        setMessages((prev) => upsertMessage(prev, data));
        setEditingMessage(null);
        return true;
      } catch (apiErr) {
        const message = apiErr.response?.data?.message || 'Failed to edit message';
        setError(message);
        addToast(message, 'error');
        return false;
      }
    }

    if (!trimmedText && !imageFile) {
      return false;
    }

    const clientMessageId = createClientMessageId();

    shouldAutoScrollRef.current = true;

    let imageUrl = '';

    if (imageFile) {
      try {
        setIsUploadingImage(true);
        const formData = new FormData();
        formData.append('image', imageFile);

        const { data } = await api.post('/messages/upload', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        imageUrl = data.imageUrl;
      } catch (err) {
        const message = err.response?.data?.message || 'Image upload failed';
        setError(message);
        addToast(message, 'error');
        setIsUploadingImage(false);
        return false;
      } finally {
        setIsUploadingImage(false);
      }
    }

    if (socket?.connected) {
      try {
        const ackMessage = isGroupChat
          ? await emitSocketAck('group_message', {
              groupId: selectedUserId,
              text: trimmedText,
              imageUrl,
              clientMessageId,
              replyTo: replyToId,
            }).then((response) => response.message)
          : await emitPrivateMessageWithAck({
              to: selectedUserId,
              text: trimmedText,
              imageUrl,
              clientMessageId,
              replyTo: replyToId,
            });

        if (isGroupChat) {
          moveGroupToTop(selectedUserId);
        } else {
          moveUserToTop(selectedUserId);
        }
        setMessages((prev) => appendUniqueMessage(prev, ackMessage));
        setReplyContext(null);
        return true;
      } catch {
        // Continue to REST fallback if realtime ack is delayed or missed.
      }
    }

    try {
      await waitForSocketConnect(socket);

      const ackMessage = isGroupChat
        ? await emitSocketAck('group_message', {
            groupId: selectedUserId,
            text: trimmedText,
            imageUrl,
            clientMessageId,
            replyTo: replyToId,
          }).then((response) => response.message)
        : await emitPrivateMessageWithAck({
            to: selectedUserId,
            text: trimmedText,
            imageUrl,
            clientMessageId,
            replyTo: replyToId,
          });

      if (isGroupChat) {
        moveGroupToTop(selectedUserId);
      } else {
        moveUserToTop(selectedUserId);
      }
      setMessages((prev) => appendUniqueMessage(prev, ackMessage));
      setReplyContext(null);
      return true;
    } catch {
      try {
        const { data } = isGroupChat
          ? await api.post(`/messages/group/${selectedUserId}`, {
              text: trimmedText,
              imageUrl,
              clientMessageId,
              replyTo: replyToId,
            })
          : await api.post('/messages', {
              receiverId: selectedUserId,
              text: trimmedText,
              imageUrl,
              clientMessageId,
              replyTo: replyToId,
            });

        setMessages((prev) => appendUniqueMessage(prev, data));
        if (isGroupChat) {
          moveGroupToTop(selectedUserId);
        } else {
          moveUserToTop(selectedUserId);
        }
        backupToastAtRef.current = Date.now();
        setReplyContext(null);
        return true;
      } catch (apiErr) {
        const message = apiErr.response?.data?.message || 'Failed to send message';
        setError(message);
        addToast(message, 'error');
        return false;
      }
    }
  };

  const handleReactMessage = async (messageId, emoji) => {
    if (!messageId || !emoji) {
      return;
    }

    if (socket?.connected) {
      try {
        const response = await emitSocketAck('message_react', { messageId, emoji });
        if (response?.message) {
          setMessages((prev) => upsertMessage(prev, response.message));
          return;
        }
      } catch {
        // Fallback to REST path.
      }
    }

    try {
      const { data } = await api.patch(`/messages/reactions/${messageId}`, { emoji });
      setMessages((prev) => upsertMessage(prev, data));
    } catch {
      addToast('Failed to react to message', 'error');
    }
  };

  const handleDeleteMessage = async (messageId, mode) => {
    if (!messageId || !mode) {
      return;
    }

    let handledViaSocket = false;

    if (socket?.connected) {
      try {
        const response = await emitSocketAck('message_delete', { messageId, mode });
        if (response?.mode === 'me') {
          setMessages((prev) => prev.filter((message) => String(message._id) !== String(messageId)));
        } else if (response?.mode === 'everyone' && response?.message) {
          setMessages((prev) => upsertMessage(prev, response.message));
        }
        handledViaSocket = true;
      } catch {
        // Fallback to REST path.
      }
    }

    if (!handledViaSocket) {
      try {
        const { data } = await api.patch(`/messages/delete/${messageId}`, { mode });
        if (mode === 'me') {
          setMessages((prev) => prev.filter((message) => String(message._id) !== String(messageId)));
        } else {
          setMessages((prev) => upsertMessage(prev, data));
        }
      } catch {
        addToast('Failed to delete message', 'error');
      }
    }

    if (editingMessage && String(editingMessage._id) === String(messageId)) {
      setEditingMessage(null);
    }

    if (replyContext && String(replyContext._id) === String(messageId)) {
      setReplyContext(null);
    }
  };

  const handleReplyMessage = (message) => {
    if (!message || message.deleted) {
      return;
    }
    setEditingMessage(null);
    setReplyContext(message);
  };

  const handleEditMessage = (message) => {
    if (!message || message.deleted) {
      return;
    }
    if (String(message.sender?._id || message.sender) !== String(user.id)) {
      return;
    }
    setReplyContext(null);
    setEditingMessage(message);
  };

  const loadOlderMessages = async () => {
    if (!selectedUserId || !nextCursor || isLoadingOlder) {
      return;
    }

    try {
      setIsLoadingOlder(true);
      shouldAutoScrollRef.current = false;
      const data = await fetchConversation(selectedUserId, nextCursor);
      setMessages((prev) => mergeUniqueMessages(data.messages || [], prev));
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to load older messages';
      setError(message);
      addToast(message, 'error');
    } finally {
      setIsLoadingOlder(false);
      shouldAutoScrollRef.current = true;
    }
  };

  const handleTypingStart = () => {
    if (!selectedUserId || typingSentRef.current || (!isGroupChat && !canDirectChat)) {
      return;
    }

    typingSentRef.current = true;

    if (isGroupChat) {
      if (socket?.connected) {
        socket.emit('group_typing', { groupId: selectedUserId, isTyping: true });
      }
      return;
    }

    if (!socket) {
      api.post('/messages/typing', { to: selectedUserId, isTyping: true }).catch(() => {});
      return;
    }

    if (!socket.connected) {
      socket.connect();
      api.post('/messages/typing', { to: selectedUserId, isTyping: true }).catch(() => {});
    } else {
      socket.emit('typing_start', { to: selectedUserId });
      api.post('/messages/typing', { to: selectedUserId, isTyping: true }).catch(() => {});
    }
  };

  const handleTypingStop = () => {
    if (!selectedUserId || !typingSentRef.current || (!isGroupChat && !canDirectChat)) {
      return;
    }

    typingSentRef.current = false;

    if (isGroupChat) {
      if (socket?.connected) {
        socket.emit('group_typing', { groupId: selectedUserId, isTyping: false });
      }
      return;
    }

    if (socket?.connected) {
      socket.emit('typing_stop', { to: selectedUserId });
      api.post('/messages/typing', { to: selectedUserId, isTyping: false }).catch(() => {});
      return;
    }

    api.post('/messages/typing', { to: selectedUserId, isTyping: false }).catch(() => {});
  };

  const chatTitle = useMemo(() => selectedUser?.name || 'Select a user', [selectedUser]);

  return (
    <main className="dashboard">
      <Sidebar
        users={users}
        groups={groups}
        incomingRequests={incomingRequests}
        outgoingRequests={outgoingRequests}
        discoverUsers={discoverUsers}
        selectedUser={selectedUser}
        selectedGroupId={isGroupChat ? selectedUserId : null}
        onSelectUser={handleSelectUser}
        onSelectGroup={handleSelectGroup}
        onCreateGroup={handleCreateGroup}
        onSendRequest={handleSendRequest}
        onRespondRequest={handleRespondRequest}
        currentUserName={user.name}
        currentUserEmail={user.email}
        currentUserAvatar={user.avatarUrl}
        currentUserId={user.id}
        onLogout={logout}
        unreadCounts={unreadCounts}
        theme={theme}
        onToggleTheme={toggleTheme}
        onEditProfile={handleEditProfile}
      />

      <section className="dashboard__content">
        <ChatWindow
          key={chatTitle}
          messages={messages}
          selectedUser={selectedUser}
          isGroupChat={isGroupChat}
          canDirectChat={canDirectChat}
          currentUser={user}
          isTyping={isTyping}
          onStartCall={startCall}
          messagesEndRef={messagesEndRef}
          hasMore={hasMore}
          onLoadOlder={loadOlderMessages}
          isLoadingOlder={isLoadingOlder}
          onImageClick={setPreviewImageUrl}
          onReplyMessage={handleReplyMessage}
          onReactMessage={handleReactMessage}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
        />

        <MessageInput
          disabled={!selectedUser || (!isGroupChat && !canDirectChat)}
          disabledReason={!selectedUser ? 'Select a user to chat' : !isGroupChat && !canDirectChat ? 'Send request and wait for acceptance to chat' : ''}
          onSend={sendMessage}
          onTypingStart={handleTypingStart}
          onTypingStop={handleTypingStop}
          isUploadingImage={isUploadingImage}
          replyToMessage={replyContext}
          editingMessage={editingMessage}
          onCancelReply={() => setReplyContext(null)}
          onCancelEdit={() => setEditingMessage(null)}
        />
      </section>

      {previewImageUrl && (
        <div className="image-preview-overlay" onClick={() => setPreviewImageUrl('')} role="presentation">
          <div className="image-preview-modal neu-raised" onClick={(event) => event.stopPropagation()}>
            <div className="image-preview-head">
              <p>Image Preview</p>
              <div className="image-preview-actions">
                <button
                  type="button"
                  className="btn btn--ghost neu-button"
                  onClick={handleDownloadPreview}
                  disabled={isDownloadingPreview}
                >
                  {isDownloadingPreview ? 'Downloading...' : 'Download'}
                </button>
                <button
                  type="button"
                  className="image-preview-close btn btn--ghost neu-button"
                  onClick={() => setPreviewImageUrl('')}
                >
                  Close
                </button>
              </div>
            </div>
            <img src={previewImageUrl} alt="Large preview" />
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <IncomingCallModal call={incomingCall} onAccept={acceptIncomingCall} onReject={rejectIncomingCall} />
      <OutgoingCallModal call={outgoingCall} onCancel={cancelOutgoingCall} />

      {activeCall && (
        <CallOverlay
          appId={zegoAppId}
          serverSecret={zegoServerSecret}
          roomId={activeCall.roomId}
          callType={activeCall.callType}
          currentUser={user}
          peerName={activeCall.peerName}
          onHangup={endCurrentCall}
        />
      )}
    </main>
  );
};

export default ChatDashboard;
