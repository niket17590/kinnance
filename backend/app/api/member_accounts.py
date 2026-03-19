from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from app.core.database import get_db
from app.core.security import get_current_db_user
from app.schemas.member_account import MemberAccountCreate, MemberAccountUpdate, MemberAccountResponse
from app.services import member_account_service

router = APIRouter(
    prefix="/member-accounts",
    tags=["Member Accounts"]
)

@router.get("", response_model=List[MemberAccountResponse])
async def get_accounts(
    member_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all accounts — optionally filter by member"""
    return member_account_service.get_all(db, current_user.id, member_id)

@router.get("/{account_id}", response_model=MemberAccountResponse)
async def get_account(
    account_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get a single account by ID"""
    return member_account_service.get_by_id(db, account_id, current_user.id)

@router.post("", response_model=MemberAccountResponse, status_code=201)
async def create_account(
    data: MemberAccountCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Create a new account for a member"""
    return member_account_service.create(db, data, current_user.id)

@router.put("/{account_id}", response_model=MemberAccountResponse)
async def update_account(
    account_id: UUID,
    data: MemberAccountUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Update an account"""
    return member_account_service.update(db, account_id, data, current_user.id)

@router.delete("/{account_id}")
async def delete_account(
    account_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Soft delete an account"""
    return member_account_service.delete(db, account_id, current_user.id)