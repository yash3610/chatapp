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
  onForwardMessage,
  onGameAccept,
  onOpenGame,
  onGameMove,
  onGameAnswer,
  activeGame,
  messagesEndRef,
  hasMore,
  onLoadOlder,
  isLoadingOlder,
  onImageClick,
  contacts = [],
}) => {
  const messageRefs = useRef({});
  const longPressTimerRef = useRef(null);
  const [openMenuMessageId, setOpenMenuMessageId] = useState(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(null);
  const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(false);
  const [isLoadingAction, setIsLoadingAction] = useState(false);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [selectedForwardIds, setSelectedForwardIds] = useState(new Set());
  const [isForwarding, setIsForwarding] = useState(false);
  const [openGameId, setOpenGameId] = useState(null);
  const [filePreviewMessage, setFilePreviewMessage] = useState(null);

  const LONG_PRESS_MS = 450;

  useEffect(() => {
    setOpenMenuMessageId(null);
    setReactionPickerMessageId(null);
    setIsForwardModalOpen(false);
    setForwardMessage(null);
    setSelectedForwardIds(new Set());
    setForwardSearch('');
    setOpenGameId(null);
    setFilePreviewMessage(null);
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

  useEffect(() => {
    if (!activeGame?._id || isGroupChat) {
      return;
    }

    const players = activeGame.players || [];
    const otherPlayerId = players.find((id) => String(id) !== String(currentUser.id));
    if (otherPlayerId && selectedUser?._id && String(selectedUser._id) === String(otherPlayerId)) {
      if (activeGame.status === 'active' && !openGameId) {
        setOpenGameId(activeGame._id);
      }
    }
  }, [activeGame, currentUser.id, selectedUser, isGroupChat, openGameId]);

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

  const openForwardModal = (message) => {
    if (!message) {
      return;
    }
    setForwardMessage(message);
    setSelectedForwardIds(new Set());
    setForwardSearch('');
    setIsForwardModalOpen(true);
  };

  const closeForwardModal = () => {
    setIsForwardModalOpen(false);
    setForwardMessage(null);
    setSelectedForwardIds(new Set());
    setForwardSearch('');
    setIsForwarding(false);
  };

  const toggleForwardSelect = (id) => {
    setSelectedForwardIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredContacts = contacts.filter((person) => {
    if (!person) {
      return false;
    }
    if (!forwardSearch) {
      return true;
    }
    const q = forwardSearch.toLowerCase();
    return (person.name || '').toLowerCase().includes(q) || (person.email || '').toLowerCase().includes(q);
  });

  const openGameBoard = async (gameId) => {
    if (!gameId) {
      return;
    }
    await onOpenGame?.(gameId);
    setOpenGameId(gameId);
  };

  const closeGameBoard = () => {
    setOpenGameId(null);
  };

  const openFilePreview = (message) => {
    if (!message?.fileUrl) {
      return;
    }
    setFilePreviewMessage(message);
  };

  const closeFilePreview = () => {
    setFilePreviewMessage(null);
  };

  const gameTypeLabel = (gameType) => (gameType === 'quiz' ? 'Quiz' : 'Tic Tac Toe');

  const isActiveGameOpen = Boolean(activeGame && openGameId && String(activeGame._id) === String(openGameId));
  const isMyTurn = activeGame && String(activeGame.currentTurn || '') === String(currentUser.id);
  const quizQuestion = activeGame?.quiz?.questions?.[activeGame.quiz?.currentIndex || 0] || null;

  const downloadAttachment = async (message) => {
    if (!message?._id) {
      return;
    }

    const rawBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const normalizedBase = rawBase.replace(/\/+$/, '');
    const apiBase = normalizedBase.endsWith('/api')
      ? normalizedBase
      : `${normalizedBase}/api`;
    const downloadUrl = `${apiBase}/messages/download/${message._id}`;

    try {
      const token = localStorage.getItem('chat_token');
      const response = await fetch(downloadUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = message.fileName || 'download';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed', error);
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
            const isGameMessage = message.messageType === 'game';
            const isForwarded = Boolean(message.forwardedFrom || message.forwardedFromMessage);
            const forwardLabel = 'Forwarded';
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
            const canForward = !message.deleted && !isCallMessage && !isGameMessage && (message.text || message.imageUrl || message.fileUrl);
            const gameStatusLabel = message.gameStatus === 'active'
              ? 'Active'
              : message.gameStatus === 'finished'
                ? 'Finished'
                : 'Invited';
            const canAcceptGame = isGameMessage && message.gameEvent === 'invite' && !isSentByMe && message.gameStatus === 'invited';
            const canOpenGame = isGameMessage && message.gameId && (message.gameStatus === 'active' || message.gameStatus === 'finished');
            const winnerName = message.gameWinner
              ? String(message.gameWinner?._id || message.gameWinner) === String(currentUser.id)
                ? 'You'
                : message.gameWinner?.name || 'Winner'
              : 'Draw';

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
                              if (canForward) {
                                openForwardModal(message);
                              }
                              setOpenMenuMessageId(null);
                            }}
                            disabled={!canForward}
                          >
                            Forward
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

                  {isForwarded && !message.deleted && (
                    <div className="message-forwarded-label">{forwardLabel}</div>
                  )}

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

                  {isGameMessage && !message.deleted && (
                    <div className="game-card">
                      <div className="game-card__header">
                        <span className="game-card__title">{gameTypeLabel(message.gameType)}</span>
                        <span className={`game-card__status game-card__status--${message.gameStatus || 'invited'}`}>{gameStatusLabel}</span>
                      </div>
                      <div className="game-card__body">
                        {message.gameEvent === 'invite' && <p>Game invite received.</p>}
                        {message.gameEvent === 'accepted' && <p>Game started. Your turn indicator will show on the board.</p>}
                        {message.gameEvent === 'result' && <p>Result: {winnerName}</p>}
                      </div>
                      <div className="game-card__actions">
                        {canAcceptGame && (
                          <button
                            type="button"
                            className="btn btn--primary"
                            onClick={() => onGameAccept?.(message.gameId)}
                          >
                            Accept
                          </button>
                        )}
                        {canOpenGame && (
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => openGameBoard(message.gameId)}
                          >
                            Open game
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {!isGameMessage && !message.deleted && !!message.text && (
                    <p className={isCallMessage ? 'message-call-text' : ''}>
                      {isCallMessage && <span className="message-call-text__icon">📞</span>}
                      <span>{message.text}</span>
                    </p>
                  )}

                  {!isGameMessage && !message.deleted && !!message.imageUrl && (
                    <button
                      type="button"
                      className="message-image-button"
                      onClick={() => onImageClick?.(message.imageUrl)}
                    >
                      <img className="message-image" src={message.imageUrl} alt="Shared attachment" loading="lazy" />
                    </button>
                  )}

                  {!isGameMessage && !message.deleted && !!message.fileUrl && (
                    <button
                      type="button"
                      className="message-file"
                      onClick={() => openFilePreview(message)}
                    >
                      <div className="message-file__icon">📄</div>
                      <div className="message-file__info">
                        <span>{message.fileName || 'Document'}</span>
                        <small>{message.fileType || 'file'}</small>
                      </div>
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

      {isActiveGameOpen && activeGame && (
        <div className="modal-overlay" onClick={closeGameBoard} role="presentation">
          <div className="game-board-modal" onClick={(event) => event.stopPropagation()}>
            <div className="game-board-modal__header">
              <div>
                <h4>{gameTypeLabel(activeGame.gameType)}</h4>
                <p>{activeGame.status === 'finished' ? 'Game ended' : isMyTurn ? 'Your turn' : 'Opponent turn'}</p>
              </div>
              <button type="button" className="member-menu-btn" onClick={closeGameBoard} title="Close">✕</button>
            </div>

            {activeGame.gameType === 'tic_tac_toe' && (
              <div className="tic-tac-toe-grid">
                {(activeGame.ticTacToe?.board || Array(9).fill('')).map((cell, index) => (
                  <button
                    key={`cell-${index}`}
                    type="button"
                    className="tic-tac-toe-cell"
                    disabled={activeGame.status !== 'active' || !isMyTurn || Boolean(cell)}
                    onClick={() => onGameMove?.(activeGame._id, index)}
                  >
                    {cell}
                  </button>
                ))}
              </div>
            )}

            {activeGame.gameType === 'quiz' && (
              <div className="quiz-board">
                <div className="quiz-question">
                  <h5>Question {((activeGame.quiz?.currentIndex || 0) + 1)} of {activeGame.quiz?.total || 0}</h5>
                  <p>{quizQuestion?.text || 'Waiting for question...'}</p>
                </div>
                <div className="quiz-options">
                  {(quizQuestion?.options || []).map((option, index) => (
                    <button
                      key={`option-${index}`}
                      type="button"
                      className="quiz-option"
                      disabled={activeGame.status !== 'active' || !isMyTurn}
                      onClick={() => onGameAnswer?.(activeGame._id, index)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div className="quiz-scores">
                  <h6>Scores</h6>
                  <div>
                    {Object.entries(activeGame.quiz?.scores || {}).map(([playerId, score]) => (
                      <div key={playerId}>
                        <span>{String(playerId) === String(currentUser.id) ? 'You' : 'Opponent'}</span>
                        <strong>{score}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeGame.status === 'finished' && (
              <div className="game-result">
                <strong>{activeGame.winner ? (String(activeGame.winner) === String(currentUser.id) ? 'You won!' : 'Opponent won!') : 'Draw!'}</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {filePreviewMessage && (
        <div className="modal-overlay" onClick={closeFilePreview} role="presentation">
          <div className="file-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="file-preview-modal__header">
              <div>
                <h4>{filePreviewMessage.fileName || 'Attachment'}</h4>
                <p>{filePreviewMessage.fileType || 'file'}</p>
              </div>
              <button type="button" className="member-menu-btn" onClick={closeFilePreview} title="Close">✕</button>
            </div>
            {filePreviewMessage.fileType === 'application/pdf' ? (
              <iframe
                className="file-preview-modal__frame"
                src={filePreviewMessage.fileUrl}
                title="Attachment preview"
              />
            ) : (
              <div className="file-preview-modal__body">
                <p>Preview not available. Download the file to view it.</p>
              </div>
            )}
            <div className="file-preview-modal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => downloadAttachment(filePreviewMessage)}>
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {isForwardModalOpen && forwardMessage && (
        <div className="modal-overlay" onClick={closeForwardModal} role="presentation">
          <div className="add-members-modal" onClick={(event) => event.stopPropagation()}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}>
                <h4>Forward message</h4>
                <button
                  type="button"
                  className="member-menu-btn"
                  onClick={closeForwardModal}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div>
              <input
                className="search-bar"
                placeholder="Search contacts by name or email"
                value={forwardSearch}
                onChange={(event) => setForwardSearch(event.target.value)}
                autoFocus
              />

              <div style={{ display: 'grid', gap: '0.2rem' }}>
                {filteredContacts.length === 0 && (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '1.5rem', fontSize: '0.85rem' }}>
                    No contacts found
                  </div>
                )}
                {filteredContacts.map((person) => (
                  <label key={person._id}>
                    <input
                      type="checkbox"
                      checked={selectedForwardIds.has(person._id)}
                      onChange={() => toggleForwardSelect(person._id)}
                      disabled={String(person._id) === String(currentUser.id)}
                    />
                    <Avatar name={person.name} src={person.avatarUrl} size="sm" />
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{person.name}</div>
                      <small style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{person.email}</small>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <button type="button" className="btn btn--ghost" onClick={closeForwardModal}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={async () => {
                  if (!forwardMessage) {
                    return;
                  }
                  setIsForwarding(true);
                  const receiverIds = Array.from(selectedForwardIds);
                  const sent = await onForwardMessage?.(forwardMessage, receiverIds);
                  if (sent) {
                    closeForwardModal();
                  } else {
                    setIsForwarding(false);
                  }
                }}
                disabled={isForwarding || selectedForwardIds.size === 0}
              >
                Forward ({selectedForwardIds.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatWindow;
