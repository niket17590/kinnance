from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
import os

app = FastAPI(
    title="Kinnance API",
    description="Family Portfolio Management System",
    version="1.0.0"
)

# CORS — allows frontend to talk to this API
origins = [
    "http://localhost:5173",           # local dev
    "https://kinnance-dev.vercel.app", # dev deployment
]

# Add any additional frontend URL from environment
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "Kinnance API is running"}

@app.get("/health")
def health():
    return {"status": "healthy", "version": "1.0.0"}