from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.openapi.utils import get_openapi
from app.core.config import settings
from app.core.security import require_super_admin
from app.api import members
import os

# Hide docs in production by disabling default docs URLs
app = FastAPI(
    title="Kinnance API",
    description="Family Portfolio Management System",
    version="1.0.0",
    docs_url=None,    # disable default /docs
    redoc_url=None    # disable default /redoc
)

# CORS
origins = [
    "http://localhost:5173",
    "https://kinnance-dev.vercel.app",
]

# API routes
app.include_router(members.router, prefix="/api/v1")

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

# ============================================================
# Public endpoints
# ============================================================

@app.get("/")
def root():
    return {"message": "Kinnance API is running"}

@app.get("/health")
def health():
    return {"status": "healthy", "version": "1.0.0"}

# ============================================================
# Protected Swagger — super admin only
# ============================================================

@app.get("/docs", include_in_schema=False)
async def get_docs(current_user=Depends(require_super_admin)):
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="Kinnance API Docs"
    )

@app.get("/redoc", include_in_schema=False)
async def get_redoc(current_user=Depends(require_super_admin)):
    return get_redoc_html(
        openapi_url="/openapi.json",
        title="Kinnance API Docs"
    )

@app.get("/openapi.json", include_in_schema=False)
async def get_openapi_schema(current_user=Depends(require_super_admin)):
    return get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes
    )