# Patient portal API contracts

All endpoints below require the existing authenticated session unless stated otherwise. Patient routes bind reads and mutations to `req.user._id`; client-provided patient IDs are checked against the authenticated identity. The client uses `authFetch` to attach the session token.

| Workflow | Endpoint | Patient contract |
| --- | --- | --- |
| Dashboard summary | `GET /api/dashboard/patient` | Authenticated patient only; resolves patient ID from token and returns dashboard aggregates, approved plan summary, next appointment/session, follow-ups, notification count and profile completion. |
| Approved plans | `GET /api/treatment-plans/patients/:patientId` | Patient may read only own plans; response is filtered to approved plans. Clinicians have separately scoped access. |
| Patient assessment history | `GET /api/treatment-plans/patients/:patientId/assessments` | Patient may read own patient-facing assessment fields. Clinical write access remains clinician-only. |
| Sessions and schedule | `GET /sessions` | Patient receives own sessions through the safe patient projection; clinician-only notes and measurements are removed. |
| Session feedback | `POST /sessions/:sessionId/feedback` | Patient ownership and completed-session eligibility enforced by the session route. |
| Follow-ups | `GET /api/follow-ups` | Patient receives only their own follow-ups. Creation and clinical completion remain care-team workflows. |
| Notifications | `GET /api/notifications` | Returns the authenticated user's latest 100 notifications, `unreadCount`, and `totalCount`; optional `type` filter. |
| Notification read state | `POST /api/notifications/:id/read`, `POST /api/notifications/read-all` | Updates are constrained to the authenticated user's records; read-all accepts an optional validated notification type. |
| Notification preferences | `GET /api/notifications/preferences`, `PUT /api/notifications/preferences` | Reads/updates only the authenticated user's preferences with server-side field validation. |
| Profile | `/api/profile` and existing patient profile routes | Uses authenticated profile identity; patient-editable profile data is separate from clinician-authored assessments and session clinical records. |

## Responses and UI states

- Existing APIs return their established JSON envelopes; no new endpoint was added for this patient portal completion pass.
- Patient schedule returns safe session objects; the progress and schedule pages use these API records rather than local sample data.
- Loading, error, and empty states belong to each page. Retry invokes the existing fetch path.
- No endpoint for billing, dependents, or a patient document library is currently available.
