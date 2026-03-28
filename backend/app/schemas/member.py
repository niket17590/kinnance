from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from uuid import UUID

# ============================================================
# Request schemas — what the API accepts
# ============================================================


class MemberCreate(BaseModel):
    display_name: str
    member_type: str = "PERSON"
    email: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "display_name": "Niket Agrawal",
                "member_type": "PERSON",
                "email": "niket@example.com"
            }
        }


class MemberUpdate(BaseModel):
    display_name: Optional[str] = None
    member_type: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None

# ============================================================
# Response schemas — what the API returns
# ============================================================


class MemberResponse(BaseModel):
    id: UUID
    owner_id: UUID
    display_name: str
    member_type: str
    email: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
