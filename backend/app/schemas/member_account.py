from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID

class MemberAccountCreate(BaseModel):
    member_id: UUID
    broker_code: str
    account_type_code: str
    region_code: str
    nickname: Optional[str] = None
    account_number: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "member_id": "uuid-here",
                "broker_code": "WEALTHSIMPLE",
                "account_type_code": "TFSA",
                "region_code": "CA",
                "nickname": "My Main TFSA",
                "account_number": "optional"
            }
        }

class MemberAccountUpdate(BaseModel):
    nickname: Optional[str] = None
    account_number: Optional[str] = None
    is_active: Optional[bool] = None

class MemberAccountResponse(BaseModel):
    id: UUID
    member_id: UUID
    broker_code: str
    account_type_code: str
    region_code: str
    nickname: Optional[str] = None
    account_number: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True