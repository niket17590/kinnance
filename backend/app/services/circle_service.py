from sqlalchemy.orm import Session
from sqlalchemy import text
from uuid import UUID
from fastapi import HTTPException, status
from app.schemas.circle import CircleCreate, CircleUpdate


def get_all(db: Session, owner_id: UUID):
    result = db.execute(
        text("""
            SELECT c.*, COUNT(ca.id) as account_count
            FROM circles c
            LEFT JOIN circle_accounts ca ON ca.circle_id = c.id
            WHERE c.owner_id = :owner_id AND c.is_active = TRUE
            GROUP BY c.id
            ORDER BY c.name ASC
        """),
        {"owner_id": str(owner_id)}
    ).fetchall()
    return [dict(row._mapping) for row in result]


def get_all_with_accounts(db: Session, owner_id: UUID):
    """
    Single round-trip — returns all circles with their tagged accounts embedded.
    Used by the Circles page to avoid N+1 per-card fetches.
    """
    circles = db.execute(
        text("""
            SELECT id, name, region_code, description, is_active, created_at, updated_at
            FROM circles
            WHERE owner_id = :owner_id AND is_active = TRUE
            ORDER BY name ASC
        """),
        {"owner_id": str(owner_id)}
    ).fetchall()

    if not circles:
        return []

    circle_ids = [str(r.id) for r in circles]

    accounts = db.execute(
        text("""
            SELECT
                ca.circle_id,
                ma.id, ma.member_id, ma.broker_code, ma.account_type_code,
                ma.region_code, ma.nickname, ma.is_active,
                m.display_name AS member_name, m.member_type,
                at.tax_category, at.name AS account_type_name
            FROM circle_accounts ca
            JOIN member_accounts ma ON ca.account_id = ma.id
            JOIN members m ON ma.member_id = m.id
            JOIN account_types at ON ma.account_type_code = at.code
            WHERE ca.circle_id = ANY(CAST(:circle_ids AS uuid[]))
            AND ma.is_active = TRUE
            ORDER BY m.display_name ASC, ma.account_type_code ASC
        """),
        {"circle_ids": circle_ids}
    ).fetchall()

    # Group accounts by circle in Python — no extra DB calls
    accounts_by_circle: dict[str, list] = {}
    for row in accounts:
        cid = str(row.circle_id)
        if cid not in accounts_by_circle:
            accounts_by_circle[cid] = []
        accounts_by_circle[cid].append({
            "id": str(row.id),
            "member_id": str(row.member_id),
            "member_name": row.member_name,
            "broker_code": row.broker_code,
            "account_type_code": row.account_type_code,
            "account_type_name": row.account_type_name,
            "region_code": row.region_code,
            "nickname": row.nickname,
            "tax_category": row.tax_category,
        })

    return [
        {
            "id": str(c.id),
            "name": c.name,
            "region_code": c.region_code,
            "description": c.description,
            "is_active": c.is_active,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
            "accounts": accounts_by_circle.get(str(c.id), []),
        }
        for c in circles
    ]


def get_by_id(db: Session, circle_id: UUID, owner_id: UUID):
    result = db.execute(
        text("SELECT * FROM circles WHERE id = :id AND owner_id = :owner_id"),
        {"id": str(circle_id), "owner_id": str(owner_id)}
    ).fetchone()
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Circle not found")
    return result


def create(db: Session, data: CircleCreate, owner_id: UUID):
    region = db.execute(
        text("SELECT code FROM regions WHERE code = :code AND is_active = TRUE"),
        {"code": data.region_code}
    ).fetchone()
    if not region:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Region {data.region_code} not found or not active")
    result = db.execute(
        text("""
            INSERT INTO circles (owner_id, name, region_code, description)
            VALUES (:owner_id, :name, :region_code, :description)
            RETURNING *
        """),
        {"owner_id": str(owner_id), "name": data.name,
         "region_code": data.region_code, "description": data.description}
    ).fetchone()
    db.commit()
    return result


def update(db: Session, circle_id: UUID, data: CircleUpdate, owner_id: UUID):
    get_by_id(db, circle_id, owner_id)
    fields = {}
    if data.name is not None:
        fields["name"] = data.name
    if data.description is not None:
        fields["description"] = data.description
    if data.is_active is not None:
        fields["is_active"] = data.is_active
    if not fields:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")
    set_clause = ", ".join([f"{k} = :{k}" for k in fields.keys()])
    fields["id"] = str(circle_id)
    fields["owner_id"] = str(owner_id)
    result = db.execute(
        text(f"UPDATE circles SET {set_clause}, updated_at = NOW() WHERE id = :id AND owner_id = :owner_id RETURNING *"),
        fields
    ).fetchone()
    db.commit()
    return result


def delete(db: Session, circle_id: UUID, owner_id: UUID):
    get_by_id(db, circle_id, owner_id)
    db.execute(
        text("UPDATE circles SET is_active = FALSE, updated_at = NOW() WHERE id = :id AND owner_id = :owner_id"),
        {"id": str(circle_id), "owner_id": str(owner_id)}
    )
    db.commit()
    return {"message": "Circle deleted successfully"}


def get_accounts(db: Session, circle_id: UUID, owner_id: UUID):
    get_by_id(db, circle_id, owner_id)
    result = db.execute(
        text("""
            SELECT
                ma.id, ma.member_id, ma.broker_code, ma.account_type_code,
                ma.region_code, ma.nickname, ma.account_number,
                ma.is_active, ma.created_at, ma.updated_at,
                m.display_name as member_name, m.member_type,
                at.tax_category, ca.added_at
            FROM circle_accounts ca
            JOIN member_accounts ma ON ca.account_id = ma.id
            JOIN members m ON ma.member_id = m.id
            JOIN account_types at ON ma.account_type_code = at.code
            WHERE ca.circle_id = :circle_id AND ma.is_active = TRUE
            ORDER BY m.display_name, ma.account_type_code
        """),
        {"circle_id": str(circle_id)}
    ).fetchall()
    return [dict(row._mapping) for row in result]


def bulk_update_accounts(
    db: Session,
    circle_id: UUID,
    owner_id: UUID,
    add_ids: list[str],
    remove_ids: list[str]
):
    """
    Add and remove multiple accounts in a single atomic DB transaction.
    """
    circle = get_by_id(db, circle_id, owner_id)

    try:
        if add_ids:
            rows = db.execute(
                text("""
                    SELECT ma.id, ma.region_code
                    FROM member_accounts ma
                    JOIN members m ON ma.member_id = m.id
                    WHERE ma.id = ANY(CAST(:ids AS uuid[]))
                    AND m.owner_id = :owner_id
                    AND ma.is_active = TRUE
                """),
                {"ids": add_ids, "owner_id": str(owner_id)}
            ).fetchall()

            found_ids = {str(r.id) for r in rows}
            for aid in add_ids:
                if aid not in found_ids:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Account {aid} not found or does not belong to you"
                    )

            wrong_region = [str(r.id) for r in rows if r.region_code != circle.region_code]
            if wrong_region:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Some accounts do not match circle region ({circle.region_code})"
                )

            db.execute(
                text("""
                    INSERT INTO circle_accounts (circle_id, account_id)
                    SELECT :circle_id, UNNEST(CAST(:account_ids AS uuid[]))
                    ON CONFLICT DO NOTHING
                """),
                {"circle_id": str(circle_id), "account_ids": add_ids}
            )

        if remove_ids:
            db.execute(
                text("""
                    DELETE FROM circle_accounts
                    WHERE circle_id = :circle_id
                    AND account_id = ANY(CAST(:account_ids AS uuid[]))
                """),
                {"circle_id": str(circle_id), "account_ids": remove_ids}
            )

        db.commit()
        return {
            "message": "Circle accounts updated successfully",
            "added": len(add_ids),
            "removed": len(remove_ids)
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update circle accounts: {str(e)}"
        )
