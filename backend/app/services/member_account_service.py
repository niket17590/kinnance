from sqlalchemy.orm import Session
from sqlalchemy import text
from uuid import UUID
from fastapi import HTTPException, status
from app.schemas.member_account import MemberAccountCreate, MemberAccountUpdate


def verify_member_ownership(db: Session, member_id: UUID, owner_id: UUID):
    """Verify the member belongs to the current user"""
    result = db.execute(
        text(
            """
            SELECT id FROM members
            WHERE id = :member_id
            AND owner_id = :owner_id
            AND is_active = TRUE
        """
        ),
        {"member_id": str(member_id), "owner_id": str(owner_id)},
    ).fetchone()

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found or does not belong to you",
        )
    return result


def verify_broker_and_account_type(
    db: Session,
    broker_code: str,
    account_type_code: str,
    region_code: str,
    member_type: str,
):
    """Validate broker and account type exist and are valid for the region and member type"""
    broker = db.execute(
        text(
            """
            SELECT code FROM brokers
            WHERE code = :code
            AND region_code = :region_code
            AND is_active = TRUE
        """
        ),
        {"code": broker_code, "region_code": region_code},
    ).fetchone()

    if not broker:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Broker {broker_code} not found or not available in region {region_code}",
        )

    account_type = db.execute(
        text(
            """
            SELECT code, applies_to FROM account_types
            WHERE code = :code
            AND region_code = :region_code
            AND is_active = TRUE
        """
        ),
        {"code": account_type_code, "region_code": region_code},
    ).fetchone()

    if not account_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account type {account_type_code} not found or not available in region {region_code}",
        )

    if account_type.applies_to != "BOTH" and account_type.applies_to != member_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account type {account_type_code} is not available for {member_type} members",
        )


def get_all(db: Session, owner_id: UUID, member_id: UUID = None):
    """Get all accounts for a user — optionally filter by member"""
    if member_id:
        result = db.execute(
            text(
                """
                SELECT ma.*, m.display_name as member_name, m.member_type,
    at.tax_category, at.name as account_type_name,
    b.name as broker_name
FROM member_accounts ma
    JOIN members m ON ma.member_id = m.id
    JOIN account_types at ON ma.account_type_code = at.code
    JOIN brokers b ON ma.broker_code = b.code
    WHERE m.owner_id = :owner_id
    AND ma.member_id = :member_id
    AND ma.is_active = TRUE
    ORDER BY m.display_name ASC, ma.account_type_code ASC
            """
            ),
            {"owner_id": str(owner_id), "member_id": str(member_id)},
        ).fetchall()
    else:
        result = db.execute(
            text(
                """
                SELECT ma.*, m.display_name as member_name, m.member_type,
    at.tax_category, at.name as account_type_name,
    b.name as broker_name
FROM member_accounts ma
    JOIN members m ON ma.member_id = m.id
    JOIN account_types at ON ma.account_type_code = at.code
    JOIN brokers b ON ma.broker_code = b.code
    WHERE m.owner_id = :owner_id
    AND ma.is_active = TRUE
    ORDER BY m.display_name ASC, ma.account_type_code ASC
            """
            ),
            {"owner_id": str(owner_id)},
        ).fetchall()
    return [dict(row._mapping) for row in result]


def get_by_id(db: Session, account_id: UUID, owner_id: UUID):
    """Get a single account — must belong to owner via member"""
    result = db.execute(
        text(
            """
            SELECT ma.* FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE ma.id = :id
            AND m.owner_id = :owner_id
        """
        ),
        {"id": str(account_id), "owner_id": str(owner_id)},
    ).fetchone()

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Account not found"
        )
    return result


def create(db: Session, data: MemberAccountCreate, owner_id: UUID):
    """Create a new member account"""
    # Verify member belongs to user
    verify_member_ownership(db, data.member_id, owner_id)

    # Get member type for validation
    member_full = db.execute(
        text("SELECT member_type FROM members WHERE id = :id"),
        {"id": str(data.member_id)},
    ).fetchone()

    # Validate broker + account type
    verify_broker_and_account_type(
        db,
        data.broker_code,
        data.account_type_code,
        data.region_code,
        member_full.member_type,
    )

    try:
        result = db.execute(
            text(
                """
                INSERT INTO member_accounts (
                    member_id, broker_code, account_type_code,
                    region_code, nickname, account_number
                )
                VALUES (
                    :member_id, :broker_code, :account_type_code,
                    :region_code, :nickname, :account_number
                )
                RETURNING *
            """
            ),
            {
                "member_id": str(data.member_id),
                "broker_code": data.broker_code,
                "account_type_code": data.account_type_code,
                "region_code": data.region_code,
                "nickname": data.nickname,
                "account_number": data.account_number,
            },
        ).fetchone()
        db.commit()
        return result
    except Exception as e:
        db.rollback()
        if "uq_member_broker_account_type" in str(e):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This member already has this account type at this broker",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create account",
        )


def update(db: Session, account_id: UUID, data: MemberAccountUpdate, owner_id: UUID):
    """Update an account"""
    get_by_id(db, account_id, owner_id)

    fields = {}
    if data.nickname is not None:
        fields["nickname"] = data.nickname
    if data.account_number is not None:
        fields["account_number"] = data.account_number
    if data.is_active is not None:
        fields["is_active"] = data.is_active

    if not fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )

    set_clause = ", ".join([f"{k} = :{k}" for k in fields.keys()])
    fields["id"] = str(account_id)

    result = db.execute(
        text(
            f"""
            UPDATE member_accounts
            SET {set_clause}, updated_at = NOW()
            WHERE id = :id
            RETURNING *
        """
        ),
        fields,
    ).fetchone()
    db.commit()
    return result


def delete(db: Session, account_id: UUID, owner_id: UUID):
    """Soft delete an account"""
    get_by_id(db, account_id, owner_id)

    db.execute(
        text(
            """
            UPDATE member_accounts
            SET is_active = FALSE, updated_at = NOW()
            WHERE id = :id
        """
        ),
        {"id": str(account_id)},
    )
    db.commit()
    return {"message": "Account deleted successfully"}
