# AyurSutra – Panchkarma Management System

AyurSutra is a full-stack web app built for SmartBU Hackathon 2025. It helps Ayurvedic practitioners and patients manage Panchkarma therapy — scheduling sessions, tracking recovery progress, collecting feedback, and sending automated reminders over WhatsApp, in-app, and email.

## Features

- **Role-based authentication** — separate patient and practitioner accounts secured with JWT, plus Google OAuth sign-in
- **Practitioner dashboard** — view assigned patients, track their progress, add notes, and schedule therapy sessions
- **Patient dashboard** — view personal progress, upcoming sessions, and submit feedback after each session
- **Progress tracking & analytics** — session completion, wellness metrics, and recovery milestones visualized as charts and trends
- **Automated notifications** — session reminders and progress updates delivered via Twilio WhatsApp, in-app alerts, and email
- **In-app chat** — messaging between patients and practitioners

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Tailwind CSS, React Context |
| Backend | Node.js, Express |
| Database | MongoDB |
| Auth | JWT, Google OAuth |
| Notifications | Twilio (WhatsApp), Email |

## Project Structure

```
SmartBU-Hackathon25-AyurSutra/
├── client/     # React (Vite) frontend
├── server/     # Node.js/Express backend
├── ARCHITECTURE.md          # Detailed system architecture & diagrams
├── GOOGLE_AUTH_SETUP.md     # Google OAuth setup guide
└── package.json             # Root scripts (runs client + server together)
```

For a deeper look at system design — auth flow, notification pipeline, database schema, and API route structure — see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Getting Started

### Prerequisites

- Node.js (v16+ recommended)
- npm
- A MongoDB instance (local or Atlas)
- A Twilio account (for WhatsApp notifications)
- Google OAuth credentials (see [GOOGLE_AUTH_SETUP.md](./GOOGLE_AUTH_SETUP.md))

### Installation

```bash
# Clone the repo
git clone https://github.com/Rachit-patel-Github/SmartBU-Hackathon25-AyurSutra.git
cd SmartBU-Hackathon25-AyurSutra

# Install root, client, and server dependencies
npm run install-all
```

### Environment Variables

Create a `.env` file inside `server/` with values such as:

```
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_NUMBER=your_twilio_whatsapp_number
```

Refer to [GOOGLE_AUTH_SETUP.md](./GOOGLE_AUTH_SETUP.md) for step-by-step Google OAuth configuration.

### Running the App

```bash
# Run client and server together in development mode
npm run dev
```

This starts the React client and the Express server concurrently. By default the client runs on Vite's dev server and the API on the Express server (check `client/` and `server/` configs for exact ports).

## Core User Flows

- **Authentication:** users sign up/log in as a patient or practitioner, the server validates credentials and issues a JWT, which the client stores and uses for subsequent requests.
- **Practitioner flow:** log in → view patient list → select a patient → review progress → add notes → schedule sessions.
- **Patient flow:** log in → view progress → view/attend sessions → submit feedback → receive notifications.
- **Notifications:** session and progress events are queued and dispatched across WhatsApp, in-app, and email channels.

## Contributing

This project was built for SmartBU Hackathon 2025. Issues and pull requests are welcome.

## License

No license specified yet.
