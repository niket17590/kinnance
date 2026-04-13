from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from pydantic import BaseModel
from app.core.database import get_db
from app.core.security import get_current_db_user
from app.schemas.circle import CircleCreate, CircleUpdate, CircleResponse
from app.services import circle_service

router = APIRouter(prefix="/circles", tags=["Circles"])


class BulkAccountsRequest(BaseModel):
    add: list[str] = []
    remove: list[str] = []


@router.get("", response_model=List[CircleResponse])
async def get_circles(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.get_all(db, current_user.id)


@router.get("/with-accounts")
async def get_circles_with_accounts(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Single endpoint — all circles with their tagged accounts embedded.
    Replaces GET /circles + N × GET /circles/{id}/accounts on the Circles page.
    """
    return circle_service.get_all_with_accounts(db, current_user.id)


@router.get("/{circle_id}", response_model=CircleResponse)
async def get_circle(
    circle_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.get_by_id(db, circle_id, current_user.id)


@router.post("", response_model=CircleResponse, status_code=201)
async def create_circle(
    data: CircleCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.create(db, data, current_user.id)


@router.put("/{circle_id}", response_model=CircleResponse)
async def update_circle(
    circle_id: UUID,
    data: CircleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.update(db, circle_id, data, current_user.id)


@router.delete("/{circle_id}")
async def delete_circle(
    circle_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.delete(db, circle_id, current_user.id)


@router.get("/{circle_id}/accounts")
async def get_circle_accounts(
    circle_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.get_accounts(db, circle_id, current_user.id)


@router.post("/{circle_id}/accounts/bulk")
async def bulk_update_circle_accounts(
    circle_id: UUID,
    data: BulkAccountsRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Add and/or remove multiple accounts atomically.
    Body: { "add": ["uuid", ...], "remove": ["uuid", ...] }
    """
    return circle_service.bulk_update_accounts(
        db, circle_id, current_user.id, data.add, data.remove
    )
