import os
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import secrets

from app.core.config import get_settings
from app.api import members, member_accounts, circles, reference_data, imports
from app.api import transactions
from app.api import holdings

settings = get_settings()

# HTTP Basic Auth for Swagger
security = HTTPBasic()


def verify_swagger_credentials(
        credentials: HTTPBasicCredentials = Depends(security)):
    """Protect Swagger with HTTP Basic Auth."""
    correct_username = secrets.compare_digest(
        credentials.username.encode('utf-8'),
        os.getenv('SWAGGER_USERNAME', 'admin').encode('utf-8')
    )
    correct_password = secrets.compare_digest(
        credentials.password.encode('utf-8'),
        os.getenv('SWAGGER_PASSWORD', 'admin').encode('utf-8')
    )
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid credentials',
            headers={'WWW-Authenticate': 'Basic'},
        )
    return credentials.username


app = FastAPI(
    title="Kinnance API",
    version="1.0.0",
    docs_url=None,    # disable default docs
    redoc_url=None,   # disable default redoc
    openapi_url=None  # disable default openapi.json
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        os.getenv("FRONTEND_URL", "https://kinnance-dev.vercel.app")
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Protected Swagger endpoints


@app.get("/docs", include_in_schema=False)
async def get_docs(username: str = Depends(verify_swagger_credentials)):
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="Kinnance API Docs"
    )


@app.get("/openapi.json", include_in_schema=False)
async def get_openapi_schema(
        username: str = Depends(verify_swagger_credentials)):
    openapi_schema = get_openapi(
        title="Kinnance API",
        version="1.0.0",
        routes=app.routes,
    )
    # Override security scheme to match HTTPBearer
    openapi_schema["components"] = openapi_schema.get("components", {})
    openapi_schema["components"]["securitySchemes"] = {
        "HTTPBearer": {
            "type": "http",
            "scheme": "bearer",
        }
    }
    return openapi_schema

# Public endpoints


@app.get("/", include_in_schema=False)
def root():
    return {"status": "ok", "app": "Kinnance API"}


@app.get("/health", include_in_schema=False)
def health():
    return {"status": "healthy"}


# Routers
app.include_router(members.router, prefix="/api/v1")
app.include_router(member_accounts.router, prefix="/api/v1")
app.include_router(circles.router, prefix="/api/v1")
app.include_router(reference_data.router, prefix="/api/v1")
app.include_router(imports.router, prefix="/api/v1")
app.include_router(transactions.router, prefix="/api/v1")
app.include_router(holdings.router, prefix="/api/v1")