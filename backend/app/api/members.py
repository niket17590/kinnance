from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from app.core.database import get_db
from app.core.security import get_current_db_user
from app.schemas.member import MemberCreate, MemberUpdate, MemberResponse
from app.services import member_service

router = APIRouter(
    prefix="/members",
    tags=["Members"]
)

@router.get("", response_model=List[MemberResponse])
async def get_members(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all members for the current user"""
    return member_service.get_all(db, current_user.id)

@router.get("/{member_id}", response_model=MemberResponse)
async def get_member(
    member_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get a single member by ID"""
    return member_service.get_by_id(db, member_id, current_user.id)

@router.post("", response_model=MemberResponse, status_code=201)
async def create_member(
    data: MemberCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Create a new member"""
    return member_service.create(db, data, current_user.id)

@router.put("/{member_id}", response_model=MemberResponse)
async def update_member(
    member_id: UUID,
    data: MemberUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Update a member"""
    return member_service.update(db, member_id, data, current_user.id)

@router.delete("/{member_id}")
async def delete_member(
    member_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Soft delete a member"""
    return member_service.delete(db, member_id, current_user.id)