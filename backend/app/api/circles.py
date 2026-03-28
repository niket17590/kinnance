from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from app.core.database import get_db
from app.core.security import get_current_db_user
from app.schemas.circle import CircleCreate, CircleUpdate, CircleAccountAdd, CircleResponse
from app.services import circle_service

router = APIRouter(
    prefix="/circles",
    tags=["Circles"]
)


@router.get("", response_model=List[CircleResponse])
async def get_circles(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all circles for the current user"""
    return circle_service.get_all(db, current_user.id)


@router.get("/{circle_id}", response_model=CircleResponse)
async def get_circle(
    circle_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get a single circle by ID"""
    return circle_service.get_by_id(db, circle_id, current_user.id)


@router.post("", response_model=CircleResponse, status_code=201)
async def create_circle(
    data: CircleCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Create a new circle"""
    return circle_service.create(db, data, current_user.id)


@router.put("/{circle_id}", response_model=CircleResponse)
async def update_circle(
    circle_id: UUID,
    data: CircleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Update a circle"""
    return circle_service.update(db, circle_id, data, current_user.id)


@router.delete("/{circle_id}")
async def delete_circle(
    circle_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Soft delete a circle"""
    return circle_service.delete(db, circle_id, current_user.id)


@router.get("/{circle_id}/accounts")
async def get_circle_accounts(
    circle_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all accounts in a circle with member details"""
    return circle_service.get_accounts(db, circle_id, current_user.id)


@router.post("/{circle_id}/accounts")
async def add_account_to_circle(
    circle_id: UUID,
    data: CircleAccountAdd,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Add an account to a circle"""
    return circle_service.add_account(
        db, circle_id, data.account_id, current_user.id)


@router.delete("/{circle_id}/accounts/{account_id}")
async def remove_account_from_circle(
    circle_id: UUID,
    account_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Remove an account from a circle"""
    return circle_service.remove_account(
        db, circle_id, account_id, current_user.id)
