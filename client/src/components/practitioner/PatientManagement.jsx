import React, { useState, useEffect, useCallback } from 'react';
import { Users, Clock, Calendar, Activity, AlertCircle, Search } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const PatientManagement = ({ onSelectPatient }) => {
  const [patients, setPatients] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [appointmentFilter, setAppointmentFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('recent');

  const fetchPatients = useCallback(async () => {
    try {
      setError('');
      const response = await authFetch('/api/practitioner/patients');
      if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again to load your patients.' : 'Unable to load your assigned patients.');
      const data = await response.json();
      setPatients(Array.isArray(data.patients) ? data.patients : []);
      const sessionsResponse = await authFetch('/sessions');
      if (sessionsResponse.ok) {
        const sessionData = await sessionsResponse.json();
        setSessions(Array.isArray(sessionData) ? sessionData : []);
      }
    } catch (error) {
      setError(error.message || 'Unable to load your assigned patients.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'assessment-complete':
        return 'bg-blue-100 text-blue-800';
      case 'pending-approval': case 'draft':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const viewPatientDetails = (patientId) => {
    onSelectPatient?.(patientId);
  };

  const filteredPatients = patients.filter((patient) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [patient.name, patient.email, patient.phone, patient._id].some((value) => String(value || '').toLowerCase().includes(query));
    return matchesSearch && (statusFilter === 'all' || patient.treatmentStatus === statusFilter) && (appointmentFilter === 'all' || (appointmentFilter === 'upcoming' ? Boolean(patient.nextSession) : !patient.nextSession));
  }).sort((a, b) => sortOrder === 'name' ? String(a.name).localeCompare(String(b.name)) : new Date(b.lastActivity || b.createdAt) - new Date(a.lastActivity || a.createdAt));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Patient Management</h1>
        <p className="mt-2 text-gray-600">Manage and monitor your patients' progress</p>
      </div>

      {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
        <p>{error}</p>
        <button onClick={() => { setLoading(true); fetchPatients(); }} className="mt-2 underline">Try again</button>
      </div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500">Total Patients</p>
              <p className="text-2xl font-bold">{patients.length}</p>
            </div>
            <Users className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500">Active Treatments</p>
              <p className="text-2xl font-bold">
                {patients.filter(p => p.activePlan?.status === 'approved').length}
              </p>
            </div>
            <Activity className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500">Upcoming Sessions</p>
              <p className="text-2xl font-bold">{sessions.filter((session) => ['scheduled', 'confirmed'].includes(session.status) && new Date(session.date) > new Date()).length}</p>
            </div>
            <Calendar className="h-8 w-8 text-purple-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500">Awaiting Assessment</p>
              <p className="text-2xl font-bold">{patients.filter((patient) => patient.assessmentPending).length}</p>
            </div>
            <AlertCircle className="h-8 w-8 text-orange-500" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Patient List</h2>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, phone, or ID" className="w-full rounded-lg border border-amber-200 py-2 pl-9 pr-3 focus:border-amber-500 focus:outline-none" />
            </label>
            <select aria-label="Filter patients by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-amber-200 px-3 py-2">
              <option value="all">All treatment statuses</option><option value="approved">Active plan</option><option value="pending-approval">Plan pending approval</option><option value="draft">Draft plan</option><option value="assessment-complete">Assessment complete</option><option value="no-assessment">No assessment</option><option value="rejected">Rejected plan</option>
            </select>
            <select aria-label="Filter patients by next session" value={appointmentFilter} onChange={(event) => setAppointmentFilter(event.target.value)} className="rounded-lg border border-amber-200 px-3 py-2"><option value="all">Any appointment</option><option value="upcoming">Upcoming session</option><option value="none">No upcoming session</option></select>
            <select aria-label="Sort patients" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="rounded-lg border border-amber-200 px-3 py-2"><option value="recent">Recent activity</option><option value="name">Name A–Z</option></select>
            <button onClick={() => { setLoading(true); fetchPatients(); }} className="rounded-lg bg-amber-700 px-4 py-2 text-white">Refresh</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          {filteredPatients.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-500">{patients.length ? 'No patients match your search and filters.' : 'No patients are assigned to you yet.'}</div>
          )}
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Patient Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active Plan</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Next Session
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Session Summary</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPatients.map((patient) => (
                <tr 
                  key={patient._id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => viewPatientDetails(patient._id)}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center">
                <span className="text-gray-600 font-medium">
                          {(patient.name || 'P').charAt(0)}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {patient.name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {patient.email}
                        </div>
                        <div className="text-xs text-gray-500">{[patient.personalDetails?.dateOfBirth ? `${Math.max(0, Math.floor((Date.now() - new Date(patient.personalDetails.dateOfBirth).getTime()) / 31557600000))} years` : null, patient.personalDetails?.gender?.replaceAll('_', ' '), patient.phone].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap"><div className="text-sm text-gray-900">{patient.activePlan?.title || '—'}</div><div className="text-xs capitalize text-gray-500">{patient.activePlan?.status || patient.treatmentStatus}</div></td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {patient.nextSession ? new Date(patient.nextSession.date).toLocaleDateString() : 'Not scheduled'}
                    </div>
                    <div className="text-sm text-gray-500">
                      <Clock className="h-4 w-4 inline mr-1" />
                      {patient.nextSession?.startTime || '—'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap"><div className="text-sm text-gray-900">{patient.completedSessions || 0} completed</div><div className="text-xs text-gray-500">{patient.pendingSessions || 0} pending · {patient.generatedSessions || 0} generated</div></td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(patient.treatmentStatus)}`}>
                      {patient.treatmentStatus || 'No assessment'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        viewPatientDetails(patient._id);
                      }}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PatientManagement;
