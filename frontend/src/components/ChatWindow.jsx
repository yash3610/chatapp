import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';
import UserProfilePanel from './UserProfilePanel';
import GroupProfilePanel from './GroupProfilePanel';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢'];

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDateDivider = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startToday - startTarget) / 86400000);

  if (diffDays === 0) {
    return 'Today';
  }

  if (diffDays === 1) {
    return 'Yesterday';
  }

  return date.toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const ChatWindow = ({
  messages,
  selectedUser,
  isGroupChat,
  canDirectChat = true,
  currentUser,
  isTyping,
  onStartCall,
  onReplyMessage,
  onReactMessage,
  onEditMessage,
  onDeleteMessage,
  messagesEndRef,
  hasMore,
  onLoadOlder,
  isLoadingOlder,
  onImageClick,
}) => {
  const messageRefs = useRef({});
  const longPressTimerRef = useRef(null);
  const [openMenuMessageId, setOpenMenuMessageId] = useState(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(null);
  const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(false);
  const [isLoadingAction, setIsLoadingAction] = useState(false);

  const LONG_PRESS_MS = 450;

  useEffect(() => {
    setOpenMenuMessageId(null);
    setReactionPickerMessageId(null);
  }, [selectedUser?._id]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      const inMenu = event.target?.closest?.('.message-menu-wrap');
      const inReactionPicker = event.target?.closest?.('.message-reaction-picker');
      if (inMenu || inReactionPicker) {
        return;
      }

      setOpenMenuMessageId(null);
      setReactionPickerMessageId(null);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearLongPress();
  }, []);

  const summarizeReactions = useMemo(
    () => (reactions = []) => {
      const grouped = new Map();
      reactions.forEach((reaction) => {
        const emoji = reaction.emoji;
        const existing = grouped.get(emoji) || { emoji, count: 0, reactedByMe: false };
        existing.count += 1;
        if (String(reaction.user?._id || reaction.user) === String(currentUser.id)) {
          existing.reactedByMe = true;
        }
        grouped.set(emoji, existing);
      });
      return Array.from(grouped.values());
    },
    [currentUser.id]
  );

  if (!selectedUser) {
    return (
      <section className="chat-window chat-window--empty">
        <p>Select a user to start chatting.</p>
      </section>
    );
  }

  if (!isGroupChat && !canDirectChat) {
    return (
      <section className="chat-window chat-window--empty">
        <p>Send request and wait for acceptance to start chatting.</p>
      </section>
    );
  }

  const handleClearChat = async () => {
    setIsLoadingAction(true);
    try {
      await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/messages/clear-conversation/${selectedUser._id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      window.location.reload();
    } catch (error) {
      console.error('Error clearing chat:', error);
    } finally {
      setIsLoadingAction(false);
    }
  };

  const handleBlockUser = async () => {
    setIsLoadingAction(true);
    try {
      await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/users/block/${selectedUser._id}`, {
        method: 'POST',
        credentials: 'include',
      });
      window.location.reload();
    } catch (error) {
      console.error('Error blocking user:', error);
    } finally {
      setIsLoadingAction(false);
    }
  };

  const timelineItems = [];
  let previousDateKey = '';

  const getReplyPreviewLabel = (replyMessage) => {
    if (!replyMessage) {
      return '';
    }
    if (replyMessage.deleted) {
      return 'This message was deleted';
    }
    if (replyMessage.text) {
      return replyMessage.text;
    }
    if (replyMessage.imageUrl) {
      return 'Image';
    }
    return 'Message';
  };

  const scrollToOriginalMessage = (messageId) => {
    if (!messageId) {
      return;
    }
    const target = messageRefs.current[String(messageId)];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('message-bubble--flash');
      window.setTimeout(() => target.classList.remove('message-bubble--flash'), 900);
    }
  };

  messages.forEach((message) => {
    const dateObj = new Date(message.createdAt);
    const dateKey = `${dateObj.getFullYear()}-${dateObj.getMonth()}-${dateObj.getDate()}`;

    if (dateKey !== previousDateKey) {
      timelineItems.push({
        type: 'divider',
        key: `divider-${dateKey}`,
        label: formatDateDivider(message.createdAt),
      });
      previousDateKey = dateKey;
    }

    timelineItems.push({
      type: 'message',
      key: `msg-${message._id}`,
      message,
    });
  });

  return (
    <div className={`chat-window-wrapper ${isProfilePanelOpen ? 'chat-window-wrapper--panel-open' : ''}`}>
      <section className="chat-window neu-raised">
        <header className="chat-window__header">
          <div className="chat-window__user">
            <Avatar name={selectedUser.name} src={selectedUser.avatarUrl} size="md" />
            <h3>{selectedUser.name}</h3>
          </div>
          <div className="chat-window__header-right">
            {isGroupChat ? (
              <span className="badge">{selectedUser.members?.length || selectedUser.memberCount || 0} members</span>
            ) : (
              <span className={selectedUser.isOnline ? 'badge badge--online' : 'badge'}>
                {selectedUser.isOnline ? 'Online' : 'Offline'}
              </span>
            )}
            {/* Call buttons for both direct and group chats */}
            <>
              <button
                type="button"
                className="btn btn--ghost neu-button call-btn"
                aria-label="Start audio call"
                title="Audio Call"
                onClick={() => onStartCall?.('audio')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="call-btn__icon">
                  <path
                    d="M6.62 10.79a15.54 15.54 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.3.56 3.52.56a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C11.85 21 3 12.15 3 2.99a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.22.19 2.4.56 3.52a1 1 0 0 1-.24 1.02l-2.2 2.26z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="btn btn--ghost neu-button call-btn"
                aria-label="Start video call"
                title="Video Call"
                onClick={() => onStartCall?.('video')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="call-btn__icon">
                  <path
                    d="M16 8l4-2v12l-4-2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <rect
                    x="3"
                    y="6"
                    width="13"
                    height="12"
                    rx="2"
                    ry="2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
              </button>
            </>
            {/* Info button - always shown for user or group */}
            <button
              type="button"
              className="btn btn--ghost neu-button call-btn"
              onClick={() => setIsProfilePanelOpen(!isProfilePanelOpen)}
              title="View info"
              aria-label="View info"
            >
              <svg viewBox="0 0 24 24" className="info-icon">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <line x1="12" y1="16" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="8" r="0.5" fill="currentColor" />
              </svg>
            </button>
          </div>
        </header>

      <div className="messages">
        {hasMore && (
          <button className="load-older-btn neu-button" type="button" onClick={onLoadOlder} disabled={isLoadingOlder}>
            {isLoadingOlder ? 'Loading...' : 'Load older messages'}
          </button>
        )}

        {messages.length === 0 ? (
          <p className="messages__empty">No messages yet. Say hi.</p>
        ) : (
          timelineItems.map((item) => {
            if (item.type === 'divider') {
              return (
                <div key={item.key} className="date-divider">
                  <span>{item.label}</span>
                </div>
              );
            }

            const { message } = item;
            const isSentByMe = String(message.sender?._id || message.sender) === String(currentUser.id);
            const isCallMessage = message.messageType === 'call';
            const currentUserNameForAvatar = currentUser.name || currentUser.email || 'User';
            const senderName = isGroupChat ? message.sender?.name || (isSentByMe ? 'You' : 'Member') : isSentByMe ? 'You' : message.sender?.name || selectedUser.name;
            const senderAvatarName = isSentByMe ? currentUserNameForAvatar : senderName;
            const senderAvatar = isSentByMe ? currentUser.avatarUrl : message.sender?.avatarUrl || selectedUser.avatarUrl;
            const statusLabel = isSentByMe
              ? message.status === 'seen'
                ? 'Seen'
                : message.status === 'delivered'
                  ? 'Delivered'
                  : 'Sent'
              : '';
            const reactions = summarizeReactions(message.reactions || []);
            const canEdit = isSentByMe && !message.deleted && message.messageType === 'text';
            const replySenderName =
              String(message.replyTo?.sender?._id || message.replyTo?.sender) === String(currentUser.id)
                ? 'You'
                : message.replyTo?.sender?.name || selectedUser.name;

            return (
              <article key={item.key} className={`message-row ${isSentByMe ? 'message-row--me' : ''}`}>
                <Avatar name={senderAvatarName} src={senderAvatar} size="sm" className="message-avatar" />
                <div
                  className={`message-bubble neu-raised ${isSentByMe ? 'message-bubble--me' : 'message-bubble--other'} ${openMenuMessageId === message._id ? 'message-bubble--menu-open' : ''}`}
                  ref={(node) => {
                    if (node) {
                      messageRefs.current[String(message._id)] = node;
                    }
                  }}
                  onTouchStart={() => {
                    if (isCallMessage) {
                      return;
                    }
                    clearLongPress();
                    longPressTimerRef.current = window.setTimeout(() => {
                      setOpenMenuMessageId(message._id);
                      setReactionPickerMessageId(null);
                    }, LONG_PRESS_MS);
                  }}
                  onTouchEnd={clearLongPress}
                  onTouchMove={clearLongPress}
                >
                  {!isCallMessage && (
                    <div className="message-menu-wrap">
                      <button
                        type="button"
                        className="message-menu-trigger"
                        aria-label="Message options"
                        onClick={(event) => {
                          event.stopPropagation();
                          setReactionPickerMessageId(null);
                          setOpenMenuMessageId((prev) => (prev === message._id ? null : message._id));
                        }}
                      >
                        ⋮
                      </button>

                      {openMenuMessageId === message._id && (
                        <div className="message-action-menu">
                          <button
                            type="button"
                            onClick={() => {
                              onReplyMessage?.(message);
                              setOpenMenuMessageId(null);
                            }}
                            disabled={message.deleted}
                          >
                            Reply
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!message.deleted) {
                                setReactionPickerMessageId((prev) => (prev === message._id ? null : message._id));
                              }
                              setOpenMenuMessageId(null);
                            }}
                            disabled={message.deleted}
                          >
                            React
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => {
                                onEditMessage?.(message);
                                setOpenMenuMessageId(null);
                              }}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteMessage?.(message._id, 'me');
                              setOpenMenuMessageId(null);
                            }}
                            disabled={message.deleted}
                          >
                            Delete for me
                          </button>
                          {isSentByMe && (
                            <button
                              type="button"
                              className="danger"
                              onClick={() => {
                                onDeleteMessage?.(message._id, 'everyone');
                                setOpenMenuMessageId(null);
                              }}
                            >
                              Delete for everyone
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="message-bubble__meta">
                    <span>{senderName}</span>
                    <span>
                      <time>{formatTime(message.createdAt)}</time>
                      {!isGroupChat && !isCallMessage && statusLabel ? ` • ${statusLabel}` : ''}
                      {message.edited && !message.deleted ? ' • edited' : ''}
                    </span>
                  </div>

                  {message.replyTo && !message.deleted && (
                    <button
                      type="button"
                      className="message-reply-preview"
                      onClick={() => scrollToOriginalMessage(message.replyTo?._id)}
                      title="Jump to original message"
                    >
                      <small>{replySenderName}</small>
                      <span>{getReplyPreviewLabel(message.replyTo)}</span>
                    </button>
                  )}

                  {message.deleted && <p className="message-deleted">This message was deleted</p>}

                  {!message.deleted && !!message.text && (
                    <p className={isCallMessage ? 'message-call-text' : ''}>
                      {isCallMessage && <span className="message-call-text__icon">📞</span>}
                      <span>{message.text}</span>
                    </p>
                  )}

                  {!message.deleted && !!message.imageUrl && (
                    <button
                      type="button"
                      className="message-image-button"
                      onClick={() => onImageClick?.(message.imageUrl)}
                    >
                      <img className="message-image" src={message.imageUrl} alt="Shared attachment" loading="lazy" />
                    </button>
                  )}

                  {reactions.length > 0 && !message.deleted && (
                    <div className="message-reactions-list">
                      {reactions.map((reaction) => (
                        <button
                          key={`${message._id}-${reaction.emoji}`}
                          type="button"
                          className={`message-reaction-chip ${reaction.reactedByMe ? 'message-reaction-chip--mine' : ''}`}
                          onClick={() => onReactMessage?.(message._id, reaction.emoji)}
                        >
                          <span>{reaction.emoji}</span>
                          <small>{reaction.count}</small>
                        </button>
                      ))}
                    </div>
                  )}

                  {reactionPickerMessageId === message._id && !message.deleted && (
                    <div className="message-reaction-picker">
                      {REACTION_EMOJIS.map((emoji) => (
                        <button
                          key={`${message._id}-emoji-${emoji}`}
                          type="button"
                          className="message-reaction-picker__item"
                          onClick={() => {
                            onReactMessage?.(message._id, emoji);
                            setReactionPickerMessageId(null);
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}

        {isTyping && <p className="typing-indicator">{selectedUser.name} is typing...</p>}
        <div ref={messagesEndRef} />
      </div>
      </section>

      {!isGroupChat ? (
        <UserProfilePanel
          user={selectedUser}
          currentUser={currentUser}
          isOpen={isProfilePanelOpen}
          onClose={() => setIsProfilePanelOpen(false)}
          onClearChat={handleClearChat}
          onBlockUser={handleBlockUser}
          isLoadingAction={isLoadingAction}
        />
      ) : (
        <GroupProfilePanel
          groupId={selectedUser._id}
          group={selectedUser}
          currentUser={currentUser}
          isOpen={isProfilePanelOpen}
          onClose={() => setIsProfilePanelOpen(false)}
        />
      )}
    </div>
  );
};

export default ChatWindow;
