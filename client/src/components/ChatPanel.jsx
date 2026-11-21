import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '../contexts/ToastContext.jsx';
import authFetch from '../utils/apiClient';

async function bodyOf(response) { let body; try { body = await response.json(); } catch { body = {}; } if (!response.ok) throw new Error(body.message || 'Communication request failed'); return body; }

const ChatPanel = ({ currentUserEmail, currentUserId, userType }) => {
  const [messages, setMessages] = useState([]); const [text, setText] = useState('');
  const [contacts, setContacts] = useState([]); const [selectedContactId, setSelectedContactId] = useState('');
  const [state, setState] = useState('loading'); const [error, setError] = useState(''); const [sending, setSending] = useState(false); const [unreadCount, setUnreadCount] = useState(0);
  const { show } = useToast();

  useEffect(() => {
    let active = true;
    authFetch('/api/messages/contacts').then(bodyOf).then((data) => { if (!active) return; const values = data.contacts || []; setContacts(values); setSelectedContactId((current) => current || values[0]?._id || ''); setState('loaded'); }).catch((err) => { if (active) { setError(err.message); setState('error'); } });
    return () => { active = false; };
  }, [userType]);

  const fetchConversation = useCallback(async () => {
    if (!selectedContactId) { setMessages([]); return; }
    try {
      const conversationResponse = await authFetch(`/api/messages/conversation?otherUserId=${encodeURIComponent(selectedContactId)}`);
      const conversation = await bodyOf(conversationResponse);
      const inbox = await bodyOf(await authFetch('/api/messages/inbox?unreadOnly=true'));
      setMessages(Array.isArray(conversation) ? conversation : []); setUnreadCount(Number(inbox.unreadCount) || 0); setState('loaded'); setError('');
    } catch (err) { setError(err.message); setState('error'); }
  }, [selectedContactId]);

  useEffect(() => { fetchConversation(); const timer = setInterval(fetchConversation, 15000); return () => clearInterval(timer); }, [fetchConversation]);

  async function sendMessage(event) {
    event?.preventDefault(); if (!text.trim() || !selectedContactId || sending) return;
    setSending(true);
    try {
      await bodyOf(await authFetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toId: selectedContactId, text: text.trim() }) }));
      setText(''); await fetchConversation();
    } catch (err) { setError(err.message); show({ title: 'Message not sent', message: err.message }); }
    finally { setSending(false); }
  }

  return <section className="rounded-lg border border-amber-100 bg-gradient-to-br from-amber-50/50 to-orange-50/50 p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-amber-900">Care team conversation</h3><p className="text-xs text-amber-700">{unreadCount} unread message{unreadCount === 1 ? '' : 's'}</p></div>{contacts.length > 1 && <select aria-label="Choose patient" value={selectedContactId} onChange={(event) => setSelectedContactId(event.target.value)} className="rounded border border-amber-200 bg-white p-2 text-sm">{contacts.map((contact) => <option key={contact._id} value={contact._id}>{contact.name}</option>)}</select>}</div>
    {state === 'loading' && <p role="status" className="text-sm text-amber-800">Loading conversations…</p>}
    {state === 'error' && <div role="alert" className="mb-3 text-sm text-red-800">{error} <button type="button" onClick={fetchConversation} className="underline">Retry</button></div>}
    {state === 'loaded' && !contacts.length && <p className="rounded bg-white p-4 text-sm text-gray-600">Messaging is available after a practitioner is assigned to your account.</p>}
    {!!contacts.length && <><div className="mb-3 h-64 space-y-3 overflow-y-auto rounded border border-amber-200 bg-white/80 p-4" aria-live="polite">
      {messages.map((message) => { const mine = String(message.from?._id) === String(currentUserId) || message.from?.email === currentUserEmail; return <div key={message._id} className={mine ? 'text-right' : 'text-left'}><div className="mb-1 text-xs text-amber-700">{mine ? 'You' : message.from?.name || 'Care team'} · {new Date(message.createdAt).toLocaleString()}</div><p className={`inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${mine ? 'bg-amber-600 text-white' : 'border border-amber-200 bg-amber-50 text-amber-950'}`}>{message.text}</p></div>; })}
      {!messages.length && <p className="text-sm text-gray-500">No messages in this conversation yet.</p>}
    </div><form onSubmit={sendMessage} className="flex gap-2"><label className="sr-only" htmlFor="care-message">Message</label><textarea id="care-message" rows="2" maxLength="5000" value={text} onChange={(event) => setText(event.target.value)} className="min-w-0 flex-1 resize-y rounded border border-amber-200 bg-white p-3 text-sm text-amber-950" placeholder="Write a secure message…"/><button type="submit" disabled={!text.trim() || sending} className="self-end rounded bg-gradient-to-r from-amber-600 to-orange-600 px-4 py-2 text-sm text-white disabled:opacity-50">{sending ? 'Sending…' : 'Send'}</button></form></>}
  </section>;
};

export default ChatPanel;
