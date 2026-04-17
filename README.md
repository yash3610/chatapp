# Real-Time Chat App (MERN + Socket.IO)

Production-style one-to-one real-time chat app with JWT auth, online presence, and persistent messages.

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Real-time: Socket.IO
- Database: MongoDB + Mongoose
- Auth: JWT + bcrypt

## Project Structure

```text
chatapp/
  backend/
    src/
      config/
      controllers/
      middleware/
      models/
      routes/
      server.js
      socket.js
  frontend/
    src/
      api/
      components/
      context/
      pages/
      styles/
```

## Features

- Register + Login (JWT)
- Password hashing with bcrypt
- Protected chat routes (frontend + backend)
- Users list with online/offline status
- One-to-one real-time messaging with Socket.IO
- Message persistence in MongoDB
- Chat history per user
- Sender/receiver names and timestamps
- Typing indicator
- Auto-scroll to latest message
- Responsive, clean UI

## Setup Instructions

## 1) Backend setup

```bash
cd backend
npm install
npm run dev
```

Create `backend/.env` using `backend/.env.example`, then set values:

- `MONGO_URI` (your Mongo connection string)
- `JWT_SECRET` (strong random string)
- `FRONTEND_URL` (default `http://localhost:5173`)

Backend runs on: `http://localhost:5000`

## 2) Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env` using `frontend/.env.example`.

Frontend runs on: `http://localhost:5173`

## API Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/users` (protected)
- `GET /api/messages/:userId` (protected)
- `POST /api/messages` (protected fallback)

## Socket Events

- Client -> Server: `private_message`, `typing_start`, `typing_stop`
- Server -> Client: `receive_message`, `typing`, `online_users`

## Notes

- MongoDB must be running before backend start.
- If you change ports/origins, update `.env` files accordingly.
- Frontend build verified with `npm run build`.

## Smoke Test

Use the backend smoke test to validate end-to-end basics quickly:

```bash
cd backend
npm run smoke:test
```

What it validates:

- Register + login for two users
- Users list API
- Realtime text delivery via Socket.IO
- Seen status update and persistence check
- Conversation history payload shape (messages + pagination fields)

Optional image check:

```bash
cd backend
SMOKE_IMAGE_TEST=true npm run smoke:test
```

PowerShell:

```powershell
cd backend
$env:SMOKE_IMAGE_TEST = 'true'
npm run smoke:test
```

For image test, Cloudinary env variables must be set in `backend/.env`.
