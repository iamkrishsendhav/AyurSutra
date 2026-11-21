import React, { useCallback, useEffect, useState } from 'react';
import authFetch from '../utils/apiClient';

const NotificationsPanel = () => {
  const [notes, setNotes] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [state, setState] = useState('loading');

  const fetchNotes = useCallback(async () => {
    try {
      const response = await authFetch('/api/notifications');
      if (response.status === 401) {
        localStorage.removeItem('token');
        throw new Error('unauthorized');
      }
      if (!response.ok) throw new Error('request_failed');
      const result = await response.json();
      setNotes(Array.isArray(result.notifications) ? result.notifications : []);
      setUnreadCount(Number(result.unreadCount) || 0);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    fetchNotes();
    const interval = setInterval(fetchNotes, 30000);
    return () => clearInterval(interval);
  }, [fetchNotes]);

  const markRead = async (id) => {
    try {
      const response = await authFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      if (!response.ok) throw new Error('request_failed');
      setNotes((current) => current.map((note) => note._id === id ? { ...note, read: true } : note));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch {
      setState('error');
    }
  };

  const markAllRead = async () => {
    try {
      const response = await authFetch('/api/notifications/read-all', { method: 'POST' });
      if (!response.ok) throw new Error('request_failed');
      setNotes((current) => current.map((note) => ({ ...note, read: true })));
      setUnreadCount(0);
    } catch {
      setState('error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded shadow border">
        <h4 className="font-semibold mb-2">Notifications {state === 'loaded' && `(${unreadCount} unread)`}</h4>
        {state === 'loaded' && notes.some((note) => !note.read) && <button type="button" onClick={markAllRead} className="mb-2 text-xs text-amber-800 underline">Mark all as read</button>}
        {state === 'loading' && <p role="status" className="text-sm text-gray-600">Loading notifications…</p>}
        {state === 'error' && <p role="alert" className="text-sm text-amber-800">Unable to load notifications. Please sign in again or try later.</p>}
        {state === 'loaded' && notes.length === 0 && <p className="text-sm text-gray-600">You have no notifications yet.</p>}
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note._id} className={`p-2 border rounded ${note.read ? 'bg-white' : 'bg-amber-50'}`}>
              <div className="text-sm font-medium">{note.payload?.title || 'AyurSutra update'}</div>
              <div className="text-xs text-gray-600">{note.payload?.body || 'You have a new update.'}</div>
              <div className="text-xs text-gray-400">{note.channel} · {note.read ? 'Read' : 'Unread'}</div>
              {!note.read && <button type="button" onClick={() => markRead(note._id)} className="mt-2 px-2 py-1 bg-amber-700 text-white rounded text-xs">Mark as read</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default NotificationsPanel;
