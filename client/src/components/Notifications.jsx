import React, { useCallback, useEffect, useState } from 'react';
import NotificationPreferences from './Notifications/NotificationPreferences.jsx';
import NotificationsList from './Notifications/NotificationsList.jsx';
import PrecautionGuidelines from './Notifications/PrecautionGuidelines.jsx';
import ErrorBoundary from './ErrorBoundary';
import ChatPanel from './ChatPanel';
import authFetch from '../utils/apiClient';

const Notifications = ({ currentUserId, currentUserEmail, userType }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState('loading');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const loadNotifications = useCallback(async () => {
    try {
      const response = await authFetch('/api/notifications');
      if (response.status === 401) { localStorage.removeItem('token'); throw new Error('Your session expired. Please sign in again.'); }
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load notifications');
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(Number(data.unreadCount) || 0); setStatus('loaded'); setError('');
    } catch (err) { setStatus('error'); setError(err.message || 'Could not load notifications'); }
  }, []);
  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  const markRead = async (id) => {
    try {
      const response = await authFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not update notification');
      setNotifications((items) => items.map((item) => item._id === id ? { ...item, read: true } : item));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (err) { setStatus('error'); setError(err.message); }
  };
  const markAllRead = async () => {
    try {
      const response = await authFetch('/api/notifications/read-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: filter }) });
      if (!response.ok) throw new Error('Could not update notifications');
      setNotifications((items) => items.map((item) => filter === 'all' || item.type === filter ? { ...item, read: true } : item));
      await loadNotifications();
    } catch (err) { setStatus('error'); setError(err.message); }
  };
  const filtered = notifications.filter((item) => filter === 'all' || item.type === filter || item.payload?.type === filter);
  const types = [...new Set(notifications.map((item) => item.type).filter(Boolean))];

  return <ErrorBoundary><div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold text-amber-900">Notifications &amp; Messages</h2><p className="text-sm text-amber-700">{unreadCount} unread · recent notification history</p></div><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter notifications by type" className="rounded border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900"><option value="all">All notification types</option>{types.map((type) => <option key={type} value={type}>{type.replaceAll('-', ' ')}</option>)}</select></div>
    <NotificationPreferences />
    {status === 'loading' && <p role="status" className="text-amber-800">Loading notifications…</p>}
    {status === 'error' && <div role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900"><p>{error}</p><button type="button" onClick={loadNotifications} className="mt-2 underline">Try again</button></div>}
    {status === 'loaded' && unreadCount > 0 && <button type="button" onClick={markAllRead} className="text-sm text-amber-800 underline">Mark all as read</button>}
    {status === 'loaded' && <NotificationsList notifications={filtered} onMarkRead={markRead} />}
    <PrecautionGuidelines />
    <div className="rounded border bg-white p-4 shadow"><h3 className="mb-2 text-lg font-semibold text-amber-900">Secure care messages</h3><ChatPanel currentUserId={currentUserId} currentUserEmail={currentUserEmail} userType={userType} /></div>
  </div></ErrorBoundary>;
};

export default Notifications;
