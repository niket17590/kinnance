from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID

class CircleCreate(BaseModel):
    name: str
    region_code: str
    description: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Sharma Family",
                "region_code": "CA",
                "description": "Our family investment circle"
            }
        }

class CircleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class CircleAccountAdd(BaseModel):
    account_id: UUID

class CircleResponse(BaseModel):
    id: UUID
    owner_id: UUID
    name: str
    region_code: str
    description: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True