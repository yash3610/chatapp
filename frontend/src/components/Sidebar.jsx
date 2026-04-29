import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';

const Sidebar = ({
  users,
  groups,
  incomingRequests,
  outgoingRequests,
  discoverUsers,
  selectedUser,
  selectedGroupId,
  onSelectUser,
  onSelectGroup,
  onCreateGroup,
  onSendRequest,
  onRespondRequest,
  currentUserName,
  currentUserEmail,
  currentUserAvatar,
  currentUserPhone,
  currentUserBio,
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
  const [profilePhone, setProfilePhone] = useState(currentUserPhone || '');
  const [profileBio, setProfileBio] = useState(currentUserBio || '');
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
    if (isEditOpen) {
      setProfilePhone(currentUserPhone || '');
      setProfileBio(currentUserBio || '');
    }
  }, [currentUserPhone, currentUserBio, isEditOpen]);

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
        phone: profilePhone,
        bio: profileBio,
      });
      setIsEditOpen(false);
      setAvatarFile(null);
      setRemoveAvatar(false);
    } catch {
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

  const filteredIncomingRequests = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return incomingRequests;
    }

    return incomingRequests.filter((row) => {
      return (
        row.user?.name?.toLowerCase().includes(normalized)
        || row.user?.email?.toLowerCase().includes(normalized)
      );
    });
  }, [incomingRequests, query]);

  const filteredOutgoingRequests = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return outgoingRequests;
    }

    return outgoingRequests.filter((row) => {
      return (
        row.user?.name?.toLowerCase().includes(normalized)
        || row.user?.email?.toLowerCase().includes(normalized)
      );
    });
  }, [outgoingRequests, query]);

  const filteredDiscoverUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return discoverUsers;
    }

    return discoverUsers.filter((person) => {
      return (
        person.name.toLowerCase().includes(normalized)
        || person.email.toLowerCase().includes(normalized)
      );
    });
  }, [discoverUsers, query]);

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
        <span className="search-wrap__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="search-wrap__icon-svg" focusable="false">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M16 16L20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <input
          className="search-bar"
          type="text"
          placeholder="Search or start a new chat"
          aria-label="Search chats"
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
          Contacts
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
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'requests'}
          className={`sidebar__tab neu-button ${activeTab === 'requests' ? 'sidebar__tab--active neu-inset' : 'neu-raised'}`}
          onClick={() => setActiveTab('requests')}
        >
          Requests
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

        {activeTab === 'all' && filteredAllChats.length === 0 && <p className="sidebar__empty">No contacts yet</p>}
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

        {activeTab === 'requests' && (
          <>
            <section className="request-block">
              <div className="sidebar__list-head">
                <strong>Incoming</strong>
              </div>
              {filteredIncomingRequests.length === 0 && <p className="sidebar__empty">No pending requests</p>}
              {filteredIncomingRequests.map((request) => (
                <article key={request._id} className="request-card neu-inset">
                  <div className="request-card__user">
                    <Avatar name={request.user?.name} src={request.user?.avatarUrl} size="sm" />
                    <div>
                      <strong>{request.user?.name}</strong>
                      <p>{request.user?.email}</p>
                    </div>
                  </div>
                  <div className="request-card__actions">
                    <button
                      type="button"
                      className="btn btn--ghost neu-button request-action"
                      onClick={() => onRespondRequest(request._id, 'rejected')}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary neu-button request-action"
                      onClick={() => onRespondRequest(request._id, 'accepted')}
                    >
                      Accept
                    </button>
                  </div>
                </article>
              ))}
            </section>

            <section className="request-block">
              <div className="sidebar__list-head">
                <strong>Sent</strong>
              </div>
              {filteredOutgoingRequests.length === 0 && <p className="sidebar__empty">No sent requests</p>}
              {filteredOutgoingRequests.map((request) => (
                <article key={request._id} className="request-card neu-inset">
                  <div className="request-card__user">
                    <Avatar name={request.user?.name} src={request.user?.avatarUrl} size="sm" />
                    <div>
                      <strong>{request.user?.name}</strong>
                      <p>{request.user?.email}</p>
                    </div>
                  </div>
                  <span className="request-status">Pending</span>
                </article>
              ))}
            </section>

            <section className="request-block">
              <div className="sidebar__list-head">
                <strong>Find Users</strong>
              </div>
              {filteredDiscoverUsers.length === 0 && <p className="sidebar__empty">No users found</p>}
              {filteredDiscoverUsers.map((person) => {
                const pendingByMe = person.requestStatus === 'pending' && person.requestedByMe;
                const pendingFromThem = person.requestStatus === 'pending' && !person.requestedByMe;
                return (
                  <article key={person._id} className="request-card neu-inset">
                    <div className="request-card__user">
                      <Avatar name={person.name} src={person.avatarUrl} size="sm" />
                      <div>
                        <strong>{person.name}</strong>
                        <p>{person.email}</p>
                      </div>
                    </div>
                    <div className="request-card__actions">
                      {pendingByMe && <span className="request-status">Pending</span>}
                      {pendingFromThem && <span className="request-status">Respond in Incoming</span>}
                      {!pendingByMe && !pendingFromThem && (
                        <button
                          type="button"
                          className="btn btn--primary neu-button request-action"
                          onClick={() => onSendRequest(person._id)}
                        >
                          Send Request
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          </>
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
                  {(profilePhone || profileBio) && (
                    <p>
                      {[profilePhone || '', profileBio || ''].filter(Boolean).join(' • ')}
                    </p>
                  )}
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

              <div className="profile-form__section">
                <p className="profile-form__section-title">Contact</p>
                <label>
                  Phone
                  <input
                    type="text"
                    value={profilePhone}
                    maxLength={24}
                    onChange={(event) => setProfilePhone(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Bio
                  <textarea
                    value={profileBio}
                    maxLength={200}
                    rows={3}
                    onChange={(event) => setProfileBio(event.target.value)}
                    placeholder="Write a short bio..."
                  />
                </label>
              </div>

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
