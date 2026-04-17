import Avatar from './Avatar';

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
  currentUser,
  isTyping,
  onStartCall,
  messagesEndRef,
  hasMore,
  onLoadOlder,
  isLoadingOlder,
  onImageClick,
}) => {
  if (!selectedUser) {
    return (
      <section className="chat-window chat-window--empty">
        <p>Select a user to start chatting.</p>
      </section>
    );
  }

  const timelineItems = [];
  let previousDateKey = '';

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
    <section className="chat-window neu-raised">
      <header className="chat-window__header">
        <div className="chat-window__user">
          <Avatar name={selectedUser.name} src={selectedUser.avatarUrl} size="md" />
          <h3>{selectedUser.name}</h3>
        </div>
        <div className="chat-window__header-right">
          <span className={selectedUser.isOnline ? 'badge badge--online' : 'badge'}>
            {selectedUser.isOnline ? 'Online' : 'Offline'}
          </span>
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
            const senderName = isSentByMe ? 'You' : message.sender?.name || selectedUser.name;
            const senderAvatar = isSentByMe ? currentUser.avatarUrl : message.sender?.avatarUrl || selectedUser.avatarUrl;
            const statusLabel = isSentByMe
              ? message.status === 'seen'
                ? 'Seen'
                : message.status === 'delivered'
                  ? 'Delivered'
                  : 'Sent'
              : '';

            return (
              <article key={item.key} className={`message-row ${isSentByMe ? 'message-row--me' : ''}`}>
                <Avatar name={senderName} src={senderAvatar} size="sm" className="message-avatar" />
                <div
                  className={`message-bubble neu-raised ${isSentByMe ? 'message-bubble--me' : 'message-bubble--other'}`}
                >
                  <div className="message-bubble__meta">
                    <span>{senderName}</span>
                    <span>
                      <time>{formatTime(message.createdAt)}</time>
                      {!isCallMessage && statusLabel ? ` • ${statusLabel}` : ''}
                    </span>
                  </div>
                  {!!message.text && (
                    <p className={isCallMessage ? 'message-call-text' : ''}>
                      {isCallMessage && <span className="message-call-text__icon">📞</span>}
                      <span>{message.text}</span>
                    </p>
                  )}
                  {!!message.imageUrl && (
                    <button
                      type="button"
                      className="message-image-button"
                      onClick={() => onImageClick?.(message.imageUrl)}
                    >
                      <img className="message-image" src={message.imageUrl} alt="Shared attachment" loading="lazy" />
                    </button>
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
  );
};

export default ChatWindow;
