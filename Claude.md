# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**KeepMedica CRM** — A medical clinic CRM system with a Python/Flask backend and a Next.js (React) frontend. The app manages leads via a Kanban pipeline, integrates with Instagram DMs via the Meta Graph API, and includes appointments, financials, reports, and a chat module.

## Architecture

- **Backend**: Single-file Flask app (`meu_crm.py`, ~2100 lines) with SQLite (`local_crm.db`). Uses Flask-Login for session auth, werkzeug for password hashing, and the Meta Graph API for Instagram integration. All HTML was originally rendered server-side via `render_template_string`; the app now serves a REST API consumed by the frontend.
- **Frontend**: Next.js 16 app in `frontend/` using App Router, React 19, Tailwind CSS v4, and TypeScript. Uses a `(dashboard)` route group for authenticated pages (hub, leads, chat, agenda, financeiro, relatorios, suporte). Auth state managed via `AuthProvider` context that checks `/api/auth/me`.
- **API communication**: Frontend calls `http://localhost:5000/api/*` via `fetchApi()` in `src/lib/api.ts` (configurable via `NEXT_PUBLIC_API_URL`). Credentials are sent with `credentials: 'include'`.

## Development Commands

### Backend (from project root)
```bash
# Activate venv
.venv/Scripts/activate    # Windows

# Run backend server (opens browser, port 5000)
python meu_crm.py
```

### Frontend (from `frontend/`)
```bash
npm run dev      # Dev server on port 3000
npm run build    # Production build
npm run lint     # ESLint
```

Both servers must run simultaneously: backend on :5000, frontend on :3000.

## Key API Routes (backend)

| Prefix | Purpose |
|---|---|
| `/api/auth/*` | Login, logout, session check (`/auth/me`) |
| `/api/admin/*` | User/pipeline/stage CRUD (admin only) |
| `/api/settings/doctors` | Doctor list CRUD |
| `/api/appointments/*` | Appointment CRUD |
| `/api/notifications` | Activity notifications |
| `/api/instagram/connect` | Connect IG account via Meta token |
| `/api/start_fetch`, `/api/get_candidates`, `/api/confirm_lead` | Instagram lead import flow |
| `/api/chat/*` | Instagram DM threads/messages |
| `/update_stage`, `/delete_lead`, `/api/lead/update_details` | Lead management |

## Frontend Route Structure

- `/` — Login page (with Spline 3D animation, admin easter egg via A+D+M keys)
- `/hub` — Main dashboard
- `/leads` — Kanban pipeline
- `/chat` — Instagram DM integration
- `/agenda` — Appointments
- `/financeiro` — Financial module
- `/relatorios` — Reports
- `/suporte` — Support

## Important Notes

- The project language is **Brazilian Portuguese** (UI text, variable names in some places).
- The backend is a monolith — database layer, business logic, and routes are all in `meu_crm.py`. There are `copy` files (e.g., `meu_crm copy.py`) that are old backups, not active code.
- SQLite database schema includes: `pipelines`, `stages`, `leads`, `users`, `activities`, `appointments`, `notifications`, `doctors`.
- User auth has two roles: regular users and `admin`. Admin has a hidden login modal on the login page.
- The `Bkp_Flask_CRM_V1/` directory contains a previous version backup.
