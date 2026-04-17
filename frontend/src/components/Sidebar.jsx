import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';

const Sidebar = ({
  users,
  selectedUser,
  onSelectUser,
  currentUserName,
  currentUserEmail,
  currentUserAvatar,
  onLogout,
  unreadCounts,
  theme,
  onToggleTheme,
  onEditProfile,
}) => {
  const [query, setQuery] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [profileName, setProfileName] = useState(currentUserName || '');
  const [avatarFile, setAvatarFile] = useState(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    setProfileName(currentUserName || '');
  }, [currentUserName]);

  useEffect(() => {
    if (!isEditOpen) {
      setAvatarFile(null);
      setRemoveAvatar(false);
    }
  }, [isEditOpen]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [avatarFile]);

  const handleProfileSubmit = async (event) => {
    event.preventDefault();
    if (isSavingProfile) {
      return;
    }

    try {
      setIsSavingProfile(true);
      await onEditProfile({
        name: profileName,
        avatarFile,
        removeAvatar,
      });
      setIsEditOpen(false);
      setAvatarFile(null);
      setRemoveAvatar(false);
    } catch (_err) {
      // Error feedback is handled in the dashboard toast layer.
    } finally {
      setIsSavingProfile(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return users;
    }

    return users.filter((person) => {
      return (
        person.name.toLowerCase().includes(normalized) ||
        person.email.toLowerCase().includes(normalized)
      );
    });
  }, [users, query]);

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    const handleOutsideClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isMenuOpen]);

  return (
    <aside className="sidebar">
      <div className="sidebar__top neu-raised profile-card">
        <div className="profile-card__compact" ref={menuRef}>
          <Avatar name={currentUserName} src={currentUserAvatar} size="lg" />
          <button
            type="button"
            className="btn btn--ghost neu-button settings-trigger"
            onClick={() => setIsMenuOpen((prev) => !prev)}
          >
            Settings
          </button>

          {isMenuOpen && (
            <div className="settings-menu neu-raised">
              <div className="settings-menu__head">
                <p className="sidebar__label">Logged in as</p>
                <h2 className="sidebar__title">{currentUserName}</h2>
                <p className="sidebar__email">{currentUserEmail}</p>
              </div>
              <div className="sidebar__actions">
                <button
                  className="btn btn--ghost neu-button"
                  onClick={() => {
                    onToggleTheme();
                    setIsMenuOpen(false);
                  }}
                >
                  {theme === 'dark' ? 'Light' : 'Dark'}
                </button>
                <button
                  className="btn btn--ghost neu-button"
                  onClick={() => {
                    setIsEditOpen(true);
                    setIsMenuOpen(false);
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn btn--ghost neu-button"
                  onClick={() => {
                    onLogout();
                    setIsMenuOpen(false);
                  }}
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="search-wrap neu-inset">
        <input
          className="search-bar"
          type="text"
          placeholder="Search users"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="sidebar__list neu-raised">
        {filteredUsers.length === 0 ? (
          <p className="sidebar__empty">No users found</p>
        ) : (
          filteredUsers.map((user) => (
            <button
              key={user._id}
              type="button"
              className={`user-card neu-raised neu-button ${selectedUser?._id === user._id ? 'user-card--active neu-inset' : ''}`}
              onClick={() => onSelectUser(user)}
            >
              <div className="user-card__row user-card__row--top">
                <div className="user-card__identity">
                  <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                  <strong>{user.name}</strong>
                </div>
                <div className="user-card__meta-icons">
                  {!!unreadCounts?.[user._id] && (
                    <span className="unread-pill">{unreadCounts[user._id]}</span>
                  )}
                  <span className={`status-dot ${user.isOnline ? 'status-dot--online' : ''}`} />
                </div>
              </div>
              <p>{user.email}</p>
              <small>{user.isOnline ? 'Online' : 'Offline'}</small>
            </button>
          ))
        )}
      </div>

      {isEditOpen && (
        <div className="profile-modal-overlay" role="presentation" onClick={() => setIsEditOpen(false)}>
          <div className="profile-modal neu-raised" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal__head">
              <h3>Edit Profile</h3>
              <button className="btn btn--ghost neu-button" type="button" onClick={() => setIsEditOpen(false)}>
                Close
              </button>
            </div>

            <form className="profile-form" onSubmit={handleProfileSubmit}>
              <div className="profile-form__preview neu-inset">
                <Avatar
                  name={profileName || currentUserName}
                  src={removeAvatar ? '' : avatarPreviewUrl || currentUserAvatar}
                  size="lg"
                />
                <div>
                  <strong>{profileName || currentUserName}</strong>
                  <p>
                    {removeAvatar
                      ? 'Current profile photo will be removed after save.'
                      : avatarFile
                        ? 'New photo selected. Save changes to apply.'
                        : currentUserAvatar
                          ? 'Current profile photo is active.'
                          : 'No profile photo set.'}
                  </p>
                </div>
              </div>

              <label>
                Display Name
                <input
                  type="text"
                  value={profileName}
                  maxLength={40}
                  onChange={(event) => setProfileName(event.target.value)}
                />
              </label>

              <label>
                Profile Photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] || null;
                    setAvatarFile(nextFile);
                    if (nextFile) {
                      setRemoveAvatar(false);
                    }
                  }}
                />
              </label>

              <div className="profile-form__actions">
                <button
                  className="btn btn--ghost neu-button"
                  type="button"
                  onClick={() => {
                    setAvatarFile(null);
                    setRemoveAvatar(true);
                  }}
                  disabled={isSavingProfile || (!currentUserAvatar && !avatarFile)}
                >
                  Remove Photo
                </button>
                <button className="btn btn--primary" type="submit" disabled={isSavingProfile}>
                  {isSavingProfile ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
