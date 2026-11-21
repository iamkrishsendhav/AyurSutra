import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Plus, Search } from 'lucide-react';
import authFetch from '../utils/apiClient';

const emptyForm = { name: '', category: 'Panchakarma', description: '', durationMins: 60, requiredSkills: '', preparationInstructions: '', postTherapyInstructions: '', contraindications: '', active: true };

export default function TherapyCatalogue({ userType }) {
  const isAdmin = userType === 'admin';
  const [therapies, setTherapies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [active, setActive] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ q: search, category, active: isAdmin ? active : 'active' });
      const response = await authFetch(`/api/therapies?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to load therapy catalogue');
      setTherapies(Array.isArray(body.therapies) ? body.therapies : []);
      setCategories(Array.isArray(body.categories) ? body.categories : []);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [search, category, active, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (item) => {
    setEditingId(item._id);
    setForm({ name: item.name, category: item.category, description: item.description, durationMins: item.durationMins, requiredSkills: (item.requiredSkills || []).join(', '), preparationInstructions: item.preparationInstructions || '', postTherapyInstructions: item.postTherapyInstructions || '', contraindications: item.contraindications || '', active: item.active });
    setShowForm(true);
  };

  const save = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    const payload = { ...form, durationMins: Number(form.durationMins), requiredSkills: form.requiredSkills.split(',').map((item) => item.trim()).filter(Boolean) };
    try {
      const response = await authFetch(editingId ? `/api/therapies/${editingId}` : '/api/therapies', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Therapy could not be saved');
      setNotice(editingId ? 'Therapy updated.' : 'Therapy added to the catalogue.');
      setShowForm(false); setEditingId(''); setForm(emptyForm); await load();
    } catch (requestError) { setError(requestError.message); }
  };

  const toggleActive = async (item) => {
    setError(''); setNotice('');
    try {
      const response = await authFetch(`/api/therapies/${item._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !item.active }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Therapy status could not be changed');
      setNotice(`${item.name} ${item.active ? 'deactivated' : 'activated'}.`); await load();
    } catch (requestError) { setError(requestError.message); }
  };

  return <main className="space-y-5 rounded-2xl border border-amber-100 bg-[#FDF7E9] p-5 text-amber-950 sm:p-7">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><BookOpen className="h-8 w-8 text-amber-700" /><div><h1 className="text-2xl font-semibold">Panchakarma Therapy Catalogue</h1><p className="text-sm text-gray-600">Catalogue entries are supplied and maintained by AyurSutra administrators.</p></div></div>
      {isAdmin && <button type="button" onClick={() => { setForm(emptyForm); setEditingId(''); setShowForm((shown) => !shown); }} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2 font-medium text-white"><Plus className="h-4 w-4" /> Add therapy</button>}
    </header>

    {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">{notice}</p>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}

    {isAdmin && showForm && <form onSubmit={save} className="grid gap-3 rounded-xl border border-amber-200 bg-white p-5 md:grid-cols-2">
      <h2 className="text-lg font-semibold md:col-span-2">{editingId ? 'Edit catalogue entry' : 'Add catalogue therapy'}</h2>
      <label className="text-sm font-medium">Therapy name<input required maxLength="120" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2" /></label>
      <label className="text-sm font-medium">Category<input required maxLength="80" list="therapy-categories" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2" /><datalist id="therapy-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist></label>
      <label className="text-sm font-medium md:col-span-2">Description<textarea required maxLength="5000" rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2" /></label>
      <label className="text-sm font-medium">Duration (minutes)<input required type="number" min="1" max="480" value={form.durationMins} onChange={(event) => setForm({ ...form, durationMins: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2" /></label>
      <label className="text-sm font-medium">Required practitioner skills<input value={form.requiredSkills} onChange={(event) => setForm({ ...form, requiredSkills: event.target.value })} placeholder="Comma-separated, match practitioner skills" className="mt-1 block w-full rounded border border-amber-200 p-2" /></label>
      <label className="text-sm font-medium">Preparation instructions<textarea maxLength="5000" rows="3" value={form.preparationInstructions} onChange={(event) => setForm({ ...form, preparationInstructions: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2" /></label>
      <label className="text-sm font-medium">Post-therapy instructions<textarea maxLength="5000" rows="3" value={form.postTherapyInstructions} onChange={(event) => setForm({ ...form, postTherapyInstructions: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2" /></label>
      <label className="text-sm font-medium md:col-span-2">Contraindications, only from authorized clinical content<textarea maxLength="5000" rows="3" value={form.contraindications} onChange={(event) => setForm({ ...form, contraindications: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2" /></label>
      {editingId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Active in catalogue</label>}
      <div className="flex gap-2 md:col-span-2"><button disabled={loading} className="rounded-lg bg-amber-700 px-4 py-2 text-white">Save</button><button type="button" onClick={() => { setShowForm(false); setEditingId(''); }} className="rounded-lg border border-amber-300 px-4 py-2">Cancel</button></div>
    </form>}

    <form onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search therapies or skills" className="w-full rounded-lg border border-amber-200 bg-white py-2 pl-9 pr-3" /></label>
      <select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-amber-200 bg-white px-3 py-2"><option value="all">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>
      {isAdmin && <select aria-label="Filter active status" value={active} onChange={(event) => setActive(event.target.value)} className="rounded-lg border border-amber-200 bg-white px-3 py-2"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select>}
      <button className="rounded-lg border border-amber-300 px-4 py-2 sm:col-span-3 sm:justify-self-end">Search</button>
    </form>

    {loading ? <p role="status">Loading therapies…</p> : therapies.length === 0 ? <p className="rounded-xl bg-white p-5 text-center text-sm text-gray-600">No therapies found. {isAdmin ? 'Add an authorized catalogue entry to begin.' : 'Ask an administrator to publish therapies.'}</p> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{therapies.map((item) => <article key={item._id} className="flex flex-col rounded-xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-amber-700">{item.category}</p><h2 className="mt-1 text-lg font-semibold">{item.name}</h2></div><span className={`rounded-full px-2 py-1 text-xs ${item.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{item.active ? 'Active' : 'Inactive'}</span></div>
      <p className="mt-3 text-sm text-gray-700">{item.description}</p><p className="mt-3 text-sm"><strong>Duration:</strong> {item.durationMins} minutes</p>
      {item.requiredSkills?.length > 0 && <p className="mt-2 text-sm"><strong>Required skills:</strong> {item.requiredSkills.join(', ')}</p>}
      {item.preparationInstructions && <p className="mt-2 text-sm"><strong>Preparation:</strong> {item.preparationInstructions}</p>}
      {item.postTherapyInstructions && <p className="mt-2 text-sm"><strong>Aftercare:</strong> {item.postTherapyInstructions}</p>}
      {item.contraindications && <p className="mt-2 text-sm"><strong>Contraindications:</strong> {item.contraindications}</p>}
      {isAdmin && <div className="mt-auto flex gap-2 pt-4"><button type="button" onClick={() => startEdit(item)} className="rounded-lg border border-amber-300 px-3 py-2 text-sm">Edit</button><button type="button" onClick={() => toggleActive(item)} className="rounded-lg bg-amber-700 px-3 py-2 text-sm text-white">{item.active ? 'Deactivate' : 'Activate'}</button></div>}
    </article>)}</div>}
  </main>;
}
