import React, { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Leaf, LogOut, User, Search } from 'lucide-react';

const Header = ({ userRole, notifications = [], unreadCount = 0, onMarkAllRead, user, onLogout, setActiveTab, globalPatientSearch = '', onGlobalPatientSearchChange }) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showBell, setShowBell] = useState(false);
  const [actionError, setActionError] = useState('');
  const userMenuRef = useRef(null); const bellMenuRef = useRef(null);
  const name = user?.fullName || user?.name || 'Account';
  const shortName = name.trim().split(/\s+/).slice(0, 2).join(' ');
  const role = user?.userType || userRole || 'patient';

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!userMenuRef.current?.contains(event.target)) setShowUserMenu(false);
      if (!bellMenuRef.current?.contains(event.target)) setShowBell(false);
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') { setShowUserMenu(false); setShowBell(false); } };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, []);

  const openTab = (tab) => { setShowUserMenu(false); setShowBell(false); setActiveTab(tab); };
  const markAllRead = async () => {
    try { await onMarkAllRead?.(); setActionError(''); setShowBell(false); }
    catch { setActionError('Could not update notifications. Please try again.'); }
  };

  return <header className="relative z-50 border-b border-amber-200 bg-gradient-to-r from-amber-50 via-[#fffaf0] to-orange-50 shadow-sm">
    <div className="pointer-events-none absolute left-0 top-0 h-14 w-14 opacity-[0.06]"><img src="/patterns/corner-mandala.svg" alt="" className="h-full w-full"/></div>
    <div className="mx-auto flex min-h-20 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <div className="flex shrink-0 items-center gap-2.5"><span className="relative"><Leaf aria-hidden="true" className="h-9 w-9 text-amber-700"/><img src="/patterns/om-symbol.svg" alt="" className="absolute -right-1 -top-1 h-3.5 w-3.5 opacity-40"/></span><span className="font-decorative text-xl tracking-wide text-amber-950 sm:text-2xl">AyurSutra</span></div>
        <span className="hidden border-l border-amber-200 pl-4 text-sm font-medium text-amber-800 lg:block">Panchakarma Management</span>
      </div>

      {role === 'receptionist' && <label className="order-3 flex basis-full items-center gap-2 rounded-xl border border-amber-200 bg-white/80 px-3 py-2 text-amber-700 shadow-sm md:order-none md:ml-auto md:basis-auto md:max-w-md md:flex-1">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0"/>
        <span className="sr-only">Search patients by name, email, phone or patient ID</span>
        <input value={globalPatientSearch} onChange={(event) => onGlobalPatientSearchChange?.(event.target.value)} onFocus={() => setActiveTab('reception-patients')} placeholder="Search patients by name, email, phone or ID" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-amber-950 outline-none placeholder:text-amber-700/70 focus:ring-0" />
      </label>}

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
        <span className="hidden rounded-full border border-amber-200 bg-white/70 px-3 py-1.5 text-xs font-semibold capitalize text-amber-800 sm:inline-flex">{role}</span>
        <div className="relative" ref={bellMenuRef}>
          <button type="button" onClick={() => { setShowBell((value) => !value); setShowUserMenu(false); }} aria-label={`Notifications, ${unreadCount} unread`} aria-expanded={showBell} aria-controls="bell-dropdown" className="relative rounded-full p-2.5 text-amber-800 transition-colors hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
            <Bell aria-hidden="true" className="h-5 w-5 sm:h-6 sm:w-6"/>{unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-700 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          {showBell && <div id="bell-dropdown" className="absolute right-0 top-[calc(100%+0.75rem)] z-[100] w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-amber-100 px-4 py-3"><div><p className="text-sm font-semibold text-amber-950">Notifications</p><p className="text-xs text-amber-700">{unreadCount} unread</p></div><button type="button" onClick={() => openTab('notifications')} className="text-xs font-semibold text-amber-800 underline">View all</button></div>
            {actionError && <p role="alert" className="px-4 py-2 text-xs text-red-700">{actionError}</p>}
            <div className="max-h-[min(60vh,24rem)] overflow-y-auto">{notifications.slice(0, 5).map((note) => <div key={note._id} className={`border-b border-amber-50 px-4 py-3 ${note.read ? '' : 'bg-amber-50/70'}`}><p className="text-sm font-medium text-amber-950">{note.payload?.title || 'AyurSutra update'}</p><p className="mt-0.5 line-clamp-2 text-xs leading-5 text-amber-800">{note.payload?.body || 'You have a new update.'}</p><p className="mt-1 text-[11px] text-amber-600">{note.scheduledAt || note.createdAt ? new Date(note.scheduledAt || note.createdAt).toLocaleString() : ''} · {note.read ? 'Read' : 'Unread'}</p></div>)}{notifications.length === 0 && <p className="px-4 py-7 text-center text-sm text-amber-700">You have no notifications yet.</p>}</div>
            {unreadCount > 0 && <div className="border-t border-amber-100 px-4 py-3 text-right"><button type="button" onClick={markAllRead} className="text-xs font-semibold text-amber-800 hover:text-amber-950">Mark all as read</button></div>}
          </div>}
        </div>

        <div className="relative" ref={userMenuRef}>
          <button id="user-menu-button" type="button" onClick={() => { setShowUserMenu((value) => !value); setShowBell(false); }} aria-haspopup="menu" aria-expanded={showUserMenu} aria-controls="user-dropdown" className="flex max-w-[10rem] items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-amber-100/70 sm:max-w-[15rem] sm:px-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800"><User aria-hidden="true" className="h-4 w-4"/></span><span className="hidden truncate text-sm font-medium text-amber-950 md:block">{shortName}</span><ChevronDown aria-hidden="true" className="hidden h-4 w-4 text-amber-700 sm:block"/>
          </button>
          {showUserMenu && <div id="user-dropdown" role="menu" className="absolute right-0 top-[calc(100%+0.75rem)] z-[100] w-[calc(100vw-2rem)] max-w-xs overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xl">
            <div className="border-b border-amber-100 bg-amber-50/70 px-4 py-4"><p className="truncate text-sm font-semibold text-amber-950">{name}</p><p className="mt-1 truncate text-xs text-amber-700">{user?.email || ''}</p><span className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold capitalize text-amber-800">{role}</span></div>
            <div className="p-1.5"><button type="button" role="menuitem" onClick={() => openTab('profile')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-amber-900 hover:bg-amber-50"><User aria-hidden="true" className="h-4 w-4 text-amber-700"/>My profile</button><button type="button" role="menuitem" onClick={() => { setShowUserMenu(false); onLogout?.(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-800 hover:bg-red-50"><LogOut aria-hidden="true" className="h-4 w-4"/>Sign out</button></div>
          </div>}
        </div>
      </div>
    </div>
  </header>;
};

export default Header;
