# Patient portal role permissions

## Patient

- Can read and update their own patient-editable profile through authenticated profile APIs.
- Can read their own approved treatment plans and patient-facing assessment history.
- Can view their own sessions through the safe session projection and submit feedback when session rules permit.
- Can read their own follow-ups, notifications, and notification preferences; can mark only their own notifications as read.
- Patient routes derive identity from the authenticated user. A route parameter containing another patient's ID does not grant access.
- Cannot author or modify assessments, prescriptions, treatment plans, session clinical records, or practitioner observations.

## Practitioner and admin

- Existing treatment plan and assessment routes apply assigned-patient and role checks. Practitioner access is limited to assigned patients and their authored plans.
- Existing session APIs control schedule and clinical documentation operations. Patient safe projections omit practitioner notes, recommendations, and measurements.
- Existing follow-up workflows are authored/completed by the care team; patients have read-only access.

## Receptionist and therapist

- No new access was added by the patient portal work. Existing role-specific session and patient workflows remain the authority for any access.
- Patient profile/clinical information access was not broadened.

## Sensitive data boundaries

- Patient editable health profile data remains separate from clinician authored assessment and treatment records.
- Notifications are queried and mutated by authenticated recipient ID.
- No billing, family, or patient document permissions are defined because corresponding models and APIs are absent.
