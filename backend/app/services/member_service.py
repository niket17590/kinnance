from sqlalchemy.orm import Session
from sqlalchemy import text
from uuid import UUID
from fastapi import HTTPException, status
from app.schemas.member import MemberCreate, MemberUpdate

def get_all(db: Session, owner_id: UUID):
    """Get all active members for a user"""
    result = db.execute(
        text("""
            SELECT * FROM members
            WHERE owner_id = :owner_id
            AND is_active = TRUE
            ORDER BY display_name ASC
        """),
        {"owner_id": str(owner_id)}
    ).fetchall()
    return result

def get_by_id(db: Session, member_id: UUID, owner_id: UUID):
    """Get a single member by ID — must belong to owner"""
    result = db.execute(
        text("""
            SELECT * FROM members
            WHERE id = :id
            AND owner_id = :owner_id
        """),
        {"id": str(member_id), "owner_id": str(owner_id)}
    ).fetchone()

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found"
        )
    return result

def create(db: Session, data: MemberCreate, owner_id: UUID):
    """Create a new member"""
    # Validate member_type
    if data.member_type not in ("PERSON", "CORPORATION"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="member_type must be PERSON or CORPORATION"
        )

    result = db.execute(
        text("""
            INSERT INTO members (owner_id, display_name, member_type, email)
            VALUES (:owner_id, :display_name, :member_type, :email)
            RETURNING *
        """),
        {
            "owner_id": str(owner_id),
            "display_name": data.display_name,
            "member_type": data.member_type,
            "email": data.email
        }
    ).fetchone()
    db.commit()
    return result

def update(db: Session, member_id: UUID, data: MemberUpdate, owner_id: UUID):
    """Update a member — must belong to owner"""
    # Check exists
    get_by_id(db, member_id, owner_id)

    # Build dynamic update
    fields = {}
    if data.display_name is not None:
        fields["display_name"] = data.display_name
    if data.member_type is not None:
        if data.member_type not in ("PERSON", "CORPORATION"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="member_type must be PERSON or CORPORATION"
            )
        fields["member_type"] = data.member_type
    if data.email is not None:
        fields["email"] = data.email
    if data.is_active is not None:
        fields["is_active"] = data.is_active

    if not fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )

    set_clause = ", ".join([f"{k} = :{k}" for k in fields.keys()])
    fields["id"] = str(member_id)
    fields["owner_id"] = str(owner_id)

    result = db.execute(
        text(f"""
            UPDATE members
            SET {set_clause}, updated_at = NOW()
            WHERE id = :id AND owner_id = :owner_id
            RETURNING *
        """),
        fields
    ).fetchone()
    db.commit()
    return result

def delete(db: Session, member_id: UUID, owner_id: UUID):
    """Soft delete — sets is_active to false"""
    get_by_id(db, member_id, owner_id)

    db.execute(
        text("""
            UPDATE members
            SET is_active = FALSE, updated_at = NOW()
            WHERE id = :id AND owner_id = :owner_id
        """),
        {"id": str(member_id), "owner_id": str(owner_id)}
    )
    db.commit()
    return {"message": "Member deleted successfully"}