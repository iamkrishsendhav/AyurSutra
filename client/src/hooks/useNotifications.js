import { useCallback, useEffect, useState } from 'react';
import authFetch from '../utils/apiClient';

const useNotifications = (enabled = true) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!localStorage.getItem('token')) { setNotifications([]); setUnreadCount(0); setStatus('idle'); return; }
    try {
      const response = await authFetch('/api/notifications');
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) { localStorage.removeItem('token'); throw new Error('Session expired'); }
      if (!response.ok) throw new Error(body.message || 'Unable to load notifications');
      setNotifications(Array.isArray(body.notifications) ? body.notifications : []);
      setUnreadCount(Number(body.unreadCount) || 0); setStatus('loaded'); setError('');
    } catch (requestError) { setStatus('error'); setError(requestError.message); }
  }, []);

  useEffect(() => {
    if (!enabled) { setNotifications([]); setUnreadCount(0); setStatus('idle'); return undefined; }
    refresh(); const timer = setInterval(refresh, 30000); return () => clearInterval(timer);
  }, [enabled, refresh]);

  const markAsRead = useCallback(async (id) => {
    const response = await authFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    if (!response.ok) throw new Error('Unable to mark notification as read');
    await refresh();
  }, [refresh]);
  const markAllAsRead = useCallback(async () => {
    const response = await authFetch('/api/notifications/read-all', { method: 'POST' });
    if (!response.ok) throw new Error('Unable to mark notifications as read');
    await refresh();
  }, [refresh]);

  return { notifications, unreadCount, status, error, refresh, markAsRead, markAllAsRead, setNotifications };
};

export default useNotifications;
