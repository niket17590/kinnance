from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
from app.core.config import settings
import jwt

# HTTP Bearer token extractor
security = HTTPBearer()


def get_supabase_client() -> Client:
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_KEY
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """
    Validates JWT token from Authorization header.
    Returns the authenticated user's data.
    Raises 401 if token is invalid or expired.
    """
    token = credentials.credentials
    try:
        # Verify token with Supabase
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(token)

        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token"
            )

        return user_response.user

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )


async def get_current_db_user(
    current_auth_user=Depends(get_current_user)
):
    """
    Gets the full user record from our public.users table.
    Use this when you need is_super_admin or our internal user id.
    """
    from app.core.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        result = db.execute(
            text("SELECT * FROM users WHERE auth_user_id = :auth_id"),
            {"auth_id": current_auth_user.id}
        ).fetchone()

        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found in database"
            )

        return result
    finally:
        db.close()


async def require_super_admin(
    current_user=Depends(get_current_db_user)
):
    """
    Raises 403 if user is not super admin.
    Use this to protect super admin only endpoints.
    """
    if not current_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required"
        )
    return current_user
