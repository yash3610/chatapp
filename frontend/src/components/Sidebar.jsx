import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';

const Sidebar = ({
  users,
  groups,
  selectedUser,
  selectedGroupId,
  onSelectUser,
  onSelectGroup,
  onCreateGroup,
  currentUserName,
  currentUserEmail,
  currentUserAvatar,
  currentUserId,
  onLogout,
  unreadCounts,
  theme,
  onToggleTheme,
  onEditProfile,
}) => {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [profileName, setProfileName] = useState(currentUserName || '');
  const [avatarFile, setAvatarFile] = useState(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
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

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return groups;
    }

    return groups.filter((group) => group.name.toLowerCase().includes(normalized));
  }, [groups, query]);

  const filteredAllChats = useMemo(() => {
    return [
      ...filteredUsers.map((person) => ({ ...person, chatType: 'user' })),
      ...filteredGroups.map((group) => ({ ...group, chatType: 'group' })),
    ];
  }, [filteredUsers, filteredGroups]);

  const selectableMembers = useMemo(
    () => users.filter((person) => String(person._id) !== String(currentUserId)),
    [users, currentUserId]
  );

  const selectedMembers = useMemo(
    () => selectableMembers.filter((member) => groupMemberIds.includes(member._id)),
    [selectableMembers, groupMemberIds]
  );

  const handleCreateGroupSubmit = async (event) => {
    event.preventDefault();
    if (isCreatingGroup) {
      return;
    }

    try {
      setIsCreatingGroup(true);
      await onCreateGroup({
        name: groupName,
        memberIds: groupMemberIds,
      });
      setIsCreateGroupOpen(false);
      setGroupName('');
      setGroupMemberIds([]);
    } finally {
      setIsCreatingGroup(false);
    }
  };

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
          placeholder="Search or start a new chat"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="sidebar__tabs" role="tablist" aria-label="Chat filters">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'all'}
          className={`sidebar__tab neu-button ${activeTab === 'all' ? 'sidebar__tab--active neu-inset' : 'neu-raised'}`}
          onClick={() => setActiveTab('all')}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'groups'}
          className={`sidebar__tab neu-button ${activeTab === 'groups' ? 'sidebar__tab--active neu-inset' : 'neu-raised'}`}
          onClick={() => setActiveTab('groups')}
        >
          Groups
        </button>
      </div>

      <div className="sidebar__list neu-raised">
        {activeTab === 'groups' && (
          <div className="sidebar__list-head">
            <strong>Groups</strong>
            <button
              type="button"
              className="btn btn--ghost neu-button sidebar__create-group"
              onClick={() => setIsCreateGroupOpen(true)}
            >
              Create New Group
            </button>
          </div>
        )}

        {activeTab === 'all' && filteredAllChats.length === 0 && <p className="sidebar__empty">No chats found</p>}
        {activeTab === 'groups' && filteredGroups.length === 0 && <p className="sidebar__empty">No groups yet</p>}

        {activeTab === 'all' &&
          filteredAllChats.map((chat) => {
            if (chat.chatType === 'group') {
              return (
                <button
                  key={`group-${chat._id}`}
                  type="button"
                  className={`user-card neu-raised neu-button ${selectedGroupId === chat._id ? 'user-card--active neu-inset' : ''}`}
                  onClick={() => onSelectGroup(chat)}
                >
                  <div className="user-card__row user-card__row--top">
                    <div className="user-card__identity">
                      <Avatar name={chat.name} src={chat.groupImage} size="sm" />
                      <strong>{chat.name}</strong>
                    </div>
                    <div className="user-card__meta-icons">
                      {!!unreadCounts?.[chat._id] && <span className="unread-pill">{unreadCounts[chat._id]}</span>}
                    </div>
                  </div>
                  <p>{chat.members?.slice(0, 2).map((member) => member.name).join(', ') || 'Group chat'}</p>
                  <small>{chat.members?.length || 0} members</small>
                </button>
              );
            }

            return (
              <button
                key={`user-${chat._id}`}
                type="button"
                className={`user-card neu-raised neu-button ${selectedUser?._id === chat._id && !selectedUser?.isGroup ? 'user-card--active neu-inset' : ''}`}
                onClick={() => onSelectUser(chat)}
              >
                <div className="user-card__row user-card__row--top">
                  <div className="user-card__identity">
                    <Avatar name={chat.name} src={chat.avatarUrl} size="sm" />
                    <strong>{chat.name}</strong>
                  </div>
                  <div className="user-card__meta-icons">
                    {!!unreadCounts?.[chat._id] && <span className="unread-pill">{unreadCounts[chat._id]}</span>}
                    <span className={`status-dot ${chat.isOnline ? 'status-dot--online' : ''}`} />
                  </div>
                </div>
                <p>{chat.email}</p>
                <small>{chat.isOnline ? 'Online' : 'Offline'}</small>
              </button>
            );
          })}

        {activeTab === 'groups' &&
          filteredGroups.map((group) => (
            <button
              key={group._id}
              type="button"
              className={`user-card neu-raised neu-button ${selectedGroupId === group._id ? 'user-card--active neu-inset' : ''}`}
              onClick={() => onSelectGroup(group)}
            >
              <div className="user-card__row user-card__row--top">
                <div className="user-card__identity">
                  <Avatar name={group.name} src={group.groupImage} size="sm" />
                  <strong>{group.name}</strong>
                </div>
                <div className="user-card__meta-icons">
                  {!!unreadCounts?.[group._id] && <span className="unread-pill">{unreadCounts[group._id]}</span>}
                </div>
              </div>
              <p>{group.members?.slice(0, 2).map((member) => member.name).join(', ') || 'Group chat'}</p>
              <small>{group.members?.length || 0} members</small>
            </button>
          ))}
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

      {isCreateGroupOpen && (
        <div className="profile-modal-overlay" role="presentation" onClick={() => setIsCreateGroupOpen(false)}>
          <div className="profile-modal profile-modal--group neu-raised" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal__head">
              <h3>Create Group</h3>
              <button className="btn btn--ghost neu-button" type="button" onClick={() => setIsCreateGroupOpen(false)}>
                Close
              </button>
            </div>

            <form className="profile-form" onSubmit={handleCreateGroupSubmit}>
              <label>
                Group Name
                <input
                  type="text"
                  value={groupName}
                  maxLength={80}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="Friends, Team, Family..."
                  required
                />
              </label>

              <div className="group-selected-row">
                <strong>Selected Members</strong>
                <span className="group-selected-count">{groupMemberIds.length}</span>
              </div>

              {selectedMembers.length > 0 && (
                <div className="group-selected-chips">
                  {selectedMembers.map((member) => (
                    <span key={`selected-${member._id}`} className="group-selected-chip neu-inset">
                      {member.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="group-members-list neu-inset">
                {selectableMembers.map((member) => {
                  const checked = groupMemberIds.includes(member._id);
                  return (
                    <label key={member._id} className="group-member-item">
                      <input
                        className="group-member-item__checkbox"
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setGroupMemberIds((prev) =>
                            checked ? prev.filter((id) => id !== member._id) : [...prev, member._id]
                          );
                        }}
                      />
                      <Avatar name={member.name} src={member.avatarUrl} size="sm" />
                      <div className="group-member-item__content">
                        <span className="group-member-item__name">{member.name}</span>
                        <small>{member.email}</small>
                      </div>
                      <span className={`status-dot ${member.isOnline ? 'status-dot--online' : ''}`} />
                    </label>
                  );
                })}
              </div>

              <div className="profile-form__actions">
                <small>{groupMemberIds.length} selected</small>
                <button
                  className="btn btn--primary"
                  type="submit"
                  disabled={isCreatingGroup || !groupName.trim() || groupMemberIds.length === 0}
                >
                  {isCreatingGroup ? 'Creating...' : 'Create Group'}
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
