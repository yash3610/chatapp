import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import api from '../api/client';

const GroupProfilePanel = ({ groupId, group, currentUser, isOpen, onClose }) => {
  const [details, setDetails] = useState(group || null);
  const [loading, setLoading] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [discoverList, setDiscoverList] = useState([]);
  const [selectedToAdd, setSelectedToAdd] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      fetchGroup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, groupId]);

  useEffect(() => {
    if (openMenuId) {
      const handleClickOutside = (event) => {
        if (menuRef.current && !menuRef.current.contains(event.target)) {
          setOpenMenuId(null);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openMenuId]);

  const fetchGroup = async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/groups/${groupId}`);
      setDetails(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (selectedToAdd.size === 0) return;
    setLoading(true);
    try {
      const ids = Array.from(selectedToAdd);
      for (const id of ids) {
        try {
          await api.post(`/groups/${groupId}/members`, { memberId: id });
        } catch (err) {
          console.error('Add member error', err);
        }
      }
      await fetchGroup();
      setIsAddModalOpen(false);
      setSelectedToAdd(new Set());
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (memberId) => {
    if (!confirm('Remove member from group?')) return;
    setLoading(true);
    try {
      const { data } = await api.delete(`/groups/${groupId}/members/${memberId}`);
      setDetails(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleMakeAdmin = async (memberId) => {
    if (!confirm('Make this member admin?')) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/groups/${groupId}/make-admin`, { memberId });
      setDetails(data);
      setOpenMenuId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAdmin = async (memberId) => {
    if (!confirm('Remove this member from admin?')) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/groups/${groupId}/remove-admin`, { memberId });
      setDetails(data);
      setOpenMenuId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filteredDiscover = discoverList.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
  });

  const toggleSelect = (id) => {
    setSelectedToAdd((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!isOpen) return null;

  if (!details) {
    return (
      <aside className="group-profile-panel neu-raised">
        <div className="user-profile-panel__header">
          <h3>Group</h3>
          <button type="button" className="btn btn--ghost neu-button" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '1rem' }}>Loading...</div>
      </aside>
    );
  }

  const adminsList = Array.isArray(details.admins) && details.admins.length > 0
    ? details.admins
    : (details.admin ? [details.admin] : []);
  const adminIds = adminsList.map((admin) => String(admin?._id || admin));
  const isAdmin = adminIds.includes(String(currentUser.id));

  return (
    <aside className="group-profile-panel neu-raised">
      <div className="user-profile-panel__header">
        <h3>Group Info</h3>
        <button type="button" className="btn btn--ghost neu-button" onClick={onClose}>✕</button>
      </div>

      <div className="user-profile-panel__content">
        <section className="user-profile-section">
          <div className="user-profile-avatar">
            <Avatar name={details.name} src={details.groupImage} size="lg" />
          </div>
          <div className="user-profile-info">
            <h4>{details.name}</h4>
            <p className="user-profile-email">{details.members?.length || 0} members</p>
            {isAdmin && <small className="user-profile-email">You are admin</small>}
          </div>
        </section>

        <section className="user-profile-actions">
          <div className="members-header">
            <h5>Members</h5>
            {isAdmin && (
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button
                  type="button"
                  className="member-action-btn"
                  title="Add member"
                  onClick={async () => {
                    setIsAddModalOpen(true);
                    setSearchQuery('');
                    setSelectedToAdd(new Set());
                    try {
                      const { data } = await api.get('/users');
                      setDiscoverList(data || []);
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                >
                  +
                </button>
              </div>
            )}
          </div>
          <div className="user-profile-actions-list">
            {details.members?.map((m) => {
              const isThisAdmin = adminIds.includes(String(m._id));
              const isThisCurrentUser = String(m._id) === String(currentUser.id);
              const canRemoveAdmin = isThisAdmin && adminIds.length > 1;
              const canRemoveThisMember = !isThisAdmin || adminIds.length > 1;
              return (
                <div key={m._id} className="member-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: 0 }}>
                    <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                        {isThisAdmin && <span className="admin-badge">admin</span>}
                      </div>
                      <small style={{ color: 'var(--muted)' }}>{m.email}</small>
                    </div>
                  </div>
                  {isAdmin && !isThisCurrentUser && (
                    <div className="member-menu-wrapper" ref={menuRef}>
                      <button
                        type="button"
                        className="member-menu-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const isOpening = openMenuId !== m._id;
                          if (isOpening) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuPos({
                              top: rect.bottom + 4,
                              right: window.innerWidth - rect.right,
                            });
                          }
                          setOpenMenuId(openMenuId === m._id ? null : m._id);
                        }}
                      >
                        ⋮
                      </button>
                      {openMenuId === m._id && menuPos && (
                        <div
                          className="member-menu-dropdown"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: 'fixed',
                            top: `${menuPos.top}px`,
                            right: `${menuPos.right}px`,
                          }}
                        >
                          {!isThisAdmin && (
                            <button
                              type="button"
                              className="member-menu-item"
                              onClick={() => { handleMakeAdmin(m._id); setOpenMenuId(null); }}
                            >
                              Make Admin
                            </button>
                          )}
                          {isThisAdmin && (
                            <button
                              type="button"
                              className="member-menu-item"
                              onClick={() => { handleRemoveAdmin(m._id); setOpenMenuId(null); }}
                              disabled={!canRemoveAdmin}
                              title={!canRemoveAdmin ? 'At least one admin must remain' : 'Remove admin'}
                            >
                              Remove Admin
                            </button>
                          )}
                          <button
                            type="button"
                            className="member-menu-item danger"
                            onClick={() => { handleRemove(m._id); setOpenMenuId(null); }}
                            disabled={!canRemoveThisMember}
                            title={!canRemoveThisMember ? 'At least one admin must remain' : 'Remove member'}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => { setIsAddModalOpen(false); setSelectedToAdd(new Set()); }}>
          <div className="add-members-modal" onClick={(e) => e.stopPropagation()}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}>
                <h4>Add Members</h4>
                <button
                  type="button"
                  className="member-menu-btn"
                  onClick={() => { setIsAddModalOpen(false); setSelectedToAdd(new Set()); }}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div>
              <input
                className="search-bar"
                placeholder="Search users by name or email"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />

              <div style={{ display: 'grid', gap: '0.2rem' }}>
                {filteredDiscover.length === 0 && (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '1.5rem', fontSize: '0.85rem' }}>
                    No users found
                  </div>
                )}
                {filteredDiscover.map((u) => (
                  <label key={u._id}>
                    <input
                      type="checkbox"
                      checked={selectedToAdd.has(u._id)}
                      onChange={() => toggleSelect(u._id)}
                      disabled={details.members?.some((m) => String(m._id) === String(u._id))}
                    />
                    <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{u.name}</div>
                      <small style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{u.email}</small>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => { setIsAddModalOpen(false); setSelectedToAdd(new Set()); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleAddMember}
                disabled={loading || selectedToAdd.size === 0}
              >
                Add ({selectedToAdd.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default GroupProfilePanel;
