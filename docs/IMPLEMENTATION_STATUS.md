# Patient portal implementation status

Scope: patient facing portal only. This status records the existing supported workflows and the remaining platform gaps. Patient identity is taken from the authenticated request on patient endpoints; patient pages do not use supplied IDs as authorization.

## Supported patient features

| Feature | Current implementation | Data source |
| --- | --- | --- |
| Dashboard | Personalized summary, appointment and therapy counts, approved plan summary, follow-ups, unread notifications, profile completion | `GET /api/dashboard/patient` |
| My Profile | Personal and patient editable health profile, emergency contact, completion guidance | `/api/profile` and existing patient profile update/upload routes |
| Find Vaidya | Practitioner discovery and profile details | Existing practitioner search routes |
| Appointments | Patient appointment list, booking/cancel/reschedule flows where server allows | `/sessions`, appointment search/booking routes |
| Approved treatment plan and progress | Approved plan details, therapy breakdown, generated/completed session counts and follow-up history | `/api/treatment-plans/patients/:patientId`, `/api/dashboard/patient`, `/sessions`, `/api/follow-ups` |
| Therapy schedule | Month/week calendar, date selection, status filters, session detail, session feedback | `/sessions`, existing patient session feedback endpoint |
| Follow-ups | Pending and completed follow-up instructions | `GET /api/follow-ups` |
| Notifications and care messages | Recent notification history, category filter, read state, preferences, secure messages | `/api/notifications`, existing message APIs |

## Explicitly unsupported

- Billing, invoices, and payment history: no patient billing model or patient billing API was found.
- Family/dependent management: no family relationship model or patient dependent API was found.
- Patient document library: no patient document model or authenticated patient document API was found. Existing practitioner session documentation is clinical record data and is not a patient document library.

These are not represented with placeholder or fabricated records. Building them requires product decisions about data ownership, retention, access roles, and any payment/document integrations.

## Current limitations

- The treatment progress screen reports plan counts only for the current approved plan; cancelled sessions remain visible in history and are not counted as completed.
- The session schema has no explicit missed status. The UI does not infer a missed visit from an old scheduled appointment.
- Notifications endpoint returns up to the latest 100 matching records. Dashboard preview returns the latest five.
- Database-backed cross-role scenarios require a seeded development environment. They were not verified as part of this documentation update.
