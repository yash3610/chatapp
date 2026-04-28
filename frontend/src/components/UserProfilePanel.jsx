import { useState } from 'react';
import Avatar from './Avatar';

const UserProfilePanel = ({
  user,
  currentUser,
  isOpen,
  onClose,
  onClearChat,
  onBlockUser,
  isLoadingAction,
  theme,
}) => {
  const [showClearChatConfirm, setShowClearChatConfirm] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  if (!isOpen || !user) {
    return null;
  }

  const isBlocked = user.blockedBy?.includes(currentUser.id);

  const handleClearChat = async () => {
    await onClearChat?.();
    setShowClearChatConfirm(false);
  };

  const handleBlockUser = async () => {
    await onBlockUser?.();
    setShowBlockConfirm(false);
  };

  return (
    <>
      <aside className="user-profile-panel neu-raised">
        <div className="user-profile-panel__header">
          <h3>Contact Info</h3>
          <button
            type="button"
            className="btn btn--ghost neu-button"
            onClick={onClose}
            aria-label="Close profile panel"
          >
            ✕
          </button>
        </div>

        <div className="user-profile-panel__content">
          {/* Profile Section */}
          <section className="user-profile-section">
            <div className="user-profile-avatar">
              <Avatar name={user.name} src={user.avatarUrl} size="lg" />
            </div>
            <div className="user-profile-info">
              <h4>{user.name}</h4>
              <p className="user-profile-email">{user.email}</p>
              <span className={`user-profile-status ${user.isOnline ? 'user-profile-status--online' : ''}`}>
                {user.isOnline ? '● Online' : '● Offline'}
              </span>
            </div>
          </section>

          {/* Actions Section */}
          <section className="user-profile-actions">
            <h5>Actions</h5>
            <div className="user-profile-actions-list">
              <button
                type="button"
                className="user-profile-action-btn neu-button"
                onClick={() => setShowClearChatConfirm(true)}
                disabled={isLoadingAction}
              >
                <span className="user-profile-action-icon">🗑️</span>
                <span>Clear Chat</span>
              </button>

              <button
                type="button"
                className={`user-profile-action-btn neu-button ${isBlocked ? 'user-profile-action-btn--active' : ''}`}
                onClick={() => setShowBlockConfirm(true)}
                disabled={isLoadingAction}
              >
                <span className="user-profile-action-icon">🚫</span>
                <span>{isBlocked ? 'Blocked' : 'Block User'}</span>
              </button>
            </div>
          </section>

          {/* Additional Info */}
          <section className="user-profile-metadata">
            <h5>Chat Details</h5>
            <div className="user-profile-metadata-item">
              <span className="label">Phone</span>
              <span className="value">{user.phone || 'Not provided'}</span>
            </div>
            <div className="user-profile-metadata-item">
              <span className="label">Bio</span>
              <span className="value">{user.bio || 'No bio'}</span>
            </div>
          </section>
        </div>
      </aside>

      {/* Clear Chat Confirmation Modal */}
      {showClearChatConfirm && (
        <div
          className="profile-modal-overlay"
          role="presentation"
          onClick={() => setShowClearChatConfirm(false)}
        >
          <div className="profile-modal neu-raised" onClick={(e) => e.stopPropagation()}>
            <h4>Clear Chat History?</h4>
            <p>This will delete all messages in this chat. This action cannot be undone.</p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost neu-button"
                onClick={() => setShowClearChatConfirm(false)}
                disabled={isLoadingAction}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger neu-button"
                onClick={handleClearChat}
                disabled={isLoadingAction}
              >
                {isLoadingAction ? 'Clearing...' : 'Clear Chat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block User Confirmation Modal */}
      {showBlockConfirm && (
        <div
          className="profile-modal-overlay"
          role="presentation"
          onClick={() => setShowBlockConfirm(false)}
        >
          <div className="profile-modal neu-raised" onClick={(e) => e.stopPropagation()}>
            <h4>{isBlocked ? 'Unblock User?' : 'Block User?'}</h4>
            <p>
              {isBlocked
                ? `${user.name} will be able to message you again.`
                : `${user.name} won't be able to message you.`}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost neu-button"
                onClick={() => setShowBlockConfirm(false)}
                disabled={isLoadingAction}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn neu-button ${isBlocked ? 'btn--primary' : 'btn--danger'}`}
                onClick={handleBlockUser}
                disabled={isLoadingAction}
              >
                {isLoadingAction ? (isBlocked ? 'Unblocking...' : 'Blocking...') : isBlocked ? 'Unblock' : 'Block'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UserProfilePanel;
