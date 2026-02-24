#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Install backend deps if needed
if [[ ! -d "$ROOT_DIR/backend/.venv" ]]; then
    echo "Setting up backend virtual environment..."
    python3 -m venv "$ROOT_DIR/backend/.venv"
    "$ROOT_DIR/backend/.venv/bin/pip" install --quiet --upgrade pip
    "$ROOT_DIR/backend/.venv/bin/pip" install --quiet -e "$ROOT_DIR/backend"
fi

# Install frontend deps if needed
if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    echo "Installing frontend dependencies..."
    npm install --prefix "$ROOT_DIR/frontend" --silent
fi

# Start backend
echo "Starting backend on http://localhost:8000 ..."
"$ROOT_DIR/backend/.venv/bin/uvicorn" app.main:app --reload --app-dir "$ROOT_DIR/backend" &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend on http://localhost:5173 ..."
npm run dev --prefix "$ROOT_DIR/frontend" &
FRONTEND_PID=$!

# Cleanup on exit
trap 'echo "Shutting down..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; wait' EXIT INT TERM

echo ""
echo "Both servers running. Press Ctrl+C to stop."
wait
