from sqlalchemy.orm import Session
from sqlalchemy import text
from uuid import UUID
from fastapi import HTTPException, status
from app.schemas.circle import CircleCreate, CircleUpdate

def get_all(db: Session, owner_id: UUID):
    """Get all active circles for a user"""
    result = db.execute(
        text("""
            SELECT c.*,
                COUNT(ca.id) as account_count
            FROM circles c
            LEFT JOIN circle_accounts ca ON ca.circle_id = c.id
            WHERE c.owner_id = :owner_id
            AND c.is_active = TRUE
            GROUP BY c.id
            ORDER BY c.name ASC
        """),
        {"owner_id": str(owner_id)}
    ).fetchall()
    return [dict(row._mapping) for row in result]

def get_by_id(db: Session, circle_id: UUID, owner_id: UUID):
    """Get a single circle by ID"""
    result = db.execute(
        text("""
            SELECT * FROM circles
            WHERE id = :id
            AND owner_id = :owner_id
        """),
        {"id": str(circle_id), "owner_id": str(owner_id)}
    ).fetchone()

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Circle not found"
        )
    return result

def create(db: Session, data: CircleCreate, owner_id: UUID):
    """Create a new circle"""
    # Validate region exists
    region = db.execute(
        text("SELECT code FROM regions WHERE code = :code AND is_active = TRUE"),
        {"code": data.region_code}
    ).fetchone()

    if not region:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Region {data.region_code} not found or not active"
        )

    result = db.execute(
        text("""
            INSERT INTO circles (owner_id, name, region_code, description)
            VALUES (:owner_id, :name, :region_code, :description)
            RETURNING *
        """),
        {
            "owner_id": str(owner_id),
            "name": data.name,
            "region_code": data.region_code,
            "description": data.description
        }
    ).fetchone()
    db.commit()
    return result

def update(db: Session, circle_id: UUID, data: CircleUpdate, owner_id: UUID):
    """Update a circle"""
    get_by_id(db, circle_id, owner_id)

    fields = {}
    if data.name is not None:
        fields["name"] = data.name
    if data.description is not None:
        fields["description"] = data.description
    if data.is_active is not None:
        fields["is_active"] = data.is_active

    if not fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )

    set_clause = ", ".join([f"{k} = :{k}" for k in fields.keys()])
    fields["id"] = str(circle_id)
    fields["owner_id"] = str(owner_id)

    result = db.execute(
        text(f"""
            UPDATE circles
            SET {set_clause}, updated_at = NOW()
            WHERE id = :id AND owner_id = :owner_id
            RETURNING *
        """),
        fields
    ).fetchone()
    db.commit()
    return result

def delete(db: Session, circle_id: UUID, owner_id: UUID):
    """Soft delete a circle"""
    get_by_id(db, circle_id, owner_id)

    db.execute(
        text("""
            UPDATE circles
            SET is_active = FALSE, updated_at = NOW()
            WHERE id = :id AND owner_id = :owner_id
        """),
        {"id": str(circle_id), "owner_id": str(owner_id)}
    )
    db.commit()
    return {"message": "Circle deleted successfully"}

def get_accounts(db: Session, circle_id: UUID, owner_id: UUID):
    """Get all accounts tagged to a circle with full details"""
    get_by_id(db, circle_id, owner_id)

    result = db.execute(
        text("""
            SELECT
                ma.id,
                ma.member_id,
                ma.broker_code,
                ma.account_type_code,
                ma.region_code,
                ma.nickname,
                ma.account_number,
                ma.is_active,
                ma.created_at,
                ma.updated_at,
                m.display_name as member_name,
                m.member_type,
                at.tax_category,
                ca.added_at
            FROM circle_accounts ca
            JOIN member_accounts ma ON ca.account_id = ma.id
            JOIN members m ON ma.member_id = m.id
            JOIN account_types at ON ma.account_type_code = at.code
            WHERE ca.circle_id = :circle_id
            AND ma.is_active = TRUE
            ORDER BY m.display_name, ma.account_type_code
        """),
        {"circle_id": str(circle_id)}
    ).fetchall()

    return [dict(row._mapping) for row in result]

def add_account(db: Session, circle_id: UUID, account_id: UUID, owner_id: UUID):
    """Tag an account to a circle — validates same region"""
    circle = get_by_id(db, circle_id, owner_id)

    # Verify account belongs to user
    account = db.execute(
        text("""
            SELECT ma.* FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE ma.id = :account_id
            AND m.owner_id = :owner_id
            AND ma.is_active = TRUE
        """),
        {"account_id": str(account_id), "owner_id": str(owner_id)}
    ).fetchone()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found or does not belong to you"
        )

    # Validate same region
    if account.region_code != circle.region_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account region ({account.region_code}) does not match circle region ({circle.region_code})"
        )

    try:
        db.execute(
            text("""
                INSERT INTO circle_accounts (circle_id, account_id)
                VALUES (:circle_id, :account_id)
            """),
            {"circle_id": str(circle_id), "account_id": str(account_id)}
        )
        db.commit()
        return {"message": "Account added to circle successfully"}
    except Exception as e:
        db.rollback()
        if "uq_circle_account" in str(e):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Account is already in this circle"
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not add account to circle"
        )

def remove_account(db: Session, circle_id: UUID, account_id: UUID, owner_id: UUID):
    """Remove an account from a circle"""
    get_by_id(db, circle_id, owner_id)

    result = db.execute(
        text("""
            DELETE FROM circle_accounts
            WHERE circle_id = :circle_id
            AND account_id = :account_id
        """),
        {"circle_id": str(circle_id), "account_id": str(account_id)}
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found in this circle"
        )
    return {"message": "Account removed from circle successfully"}