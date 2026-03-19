from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db
from app.core.security import get_current_db_user

router = APIRouter(
    prefix="/reference",
    tags=["Reference Data"]
)

@router.get("/regions")
async def get_regions(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all active regions"""
    result = db.execute(
        text("SELECT * FROM regions WHERE is_active = TRUE ORDER BY name")
    ).fetchall()
    return [dict(row._mapping) for row in result]

@router.get("/brokers")
async def get_brokers(
    region_code: str = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all active brokers — optionally filter by region"""
    if region_code:
        result = db.execute(
            text("""
                SELECT * FROM brokers
                WHERE is_active = TRUE
                AND region_code = :region_code
                ORDER BY name
            """),
            {"region_code": region_code}
        ).fetchall()
    else:
        result = db.execute(
            text("SELECT * FROM brokers WHERE is_active = TRUE ORDER BY name")
        ).fetchall()
    return [dict(row._mapping) for row in result]

@router.get("/account-types")
async def get_account_types(
    region_code: str = None,
    applies_to: str = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Get all active account types.
    Filter by region and/or member type (PERSON, CORPORATION, BOTH)
    """
    query = """
        SELECT * FROM account_types
        WHERE is_active = TRUE
    """
    params = {}

    if region_code:
        query += " AND region_code = :region_code"
        params["region_code"] = region_code

    if applies_to:
        query += " AND (applies_to = :applies_to OR applies_to = 'BOTH')"
        params["applies_to"] = applies_to

    query += " ORDER BY name"

    result = db.execute(text(query), params).fetchall()
    return [dict(row._mapping) for row in result]

@router.get("/currencies")
async def get_currencies(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all active currencies"""
    result = db.execute(
        text("SELECT * FROM currencies WHERE is_active = TRUE ORDER BY code")
    ).fetchall()
    return [dict(row._mapping) for row in result]

@router.get("/account-type-limits/{account_type_code}")
async def get_account_type_limits(
    account_type_code: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get annual limits for a specific account type"""
    result = db.execute(
        text("""
            SELECT * FROM account_type_limits
            WHERE account_type_code = :code
            ORDER BY tax_year DESC
        """),
        {"code": account_type_code}
    ).fetchall()
    return [dict(row._mapping) for row in result]