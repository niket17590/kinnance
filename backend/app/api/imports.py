from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from uuid import UUID
import json

from app.core.database import get_db
from app.core.security import get_current_db_user
from app.services import import_service

router = APIRouter(prefix="/imports", tags=["imports"])

ALLOWED_BROKERS = {'WEALTHSIMPLE', 'QUESTRADE', 'IBKR'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("/parse")
async def parse_file(
    file: UploadFile = File(...),
    broker_code: str = Form(...),
    member_id: str = Form(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Step 1: Parse file and match accounts. Does NOT import.
    Returns account mapping status.
    If status=NEEDS_MAPPING: show unmatched accounts to user.
    If status=READY: proceed directly to import.
    """
    broker_code = broker_code.upper()
    if broker_code not in ALLOWED_BROKERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported broker: {broker_code}"
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large — maximum 10MB"
        )

    result = import_service.parse_and_match(
        db=db,
        owner_id=UUID(str(current_user.id)),
        broker_code=broker_code,
        file_content=content,
        filename=file.filename or 'upload',
        member_id=member_id
    )
    return result


@router.post("/import")
async def do_import(
    file: UploadFile = File(...),
    broker_code: str = Form(...),
    member_id: str = Form(...),
    confirmed_mappings: str = Form(default='{}'),
    skipped_accounts: str = Form(default='[]'),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Step 2: Run the actual import.

    confirmed_mappings: JSON {broker_identifier: kinnance_account_id}
    skipped_accounts:   JSON [broker_identifier, ...]

    Returns 5 counts:
      total_transactions, imported, duplicates_skipped, accounts_skipped, failed
    """
    broker_code = broker_code.upper()

    try:
        mappings = json.loads(confirmed_mappings)
        skipped = json.loads(skipped_accounts)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON in confirmed_mappings or skipped_accounts"
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large — maximum 10MB"
        )

    result = import_service.run_import(
        db=db,
        owner_id=UUID(str(current_user.id)),
        broker_code=broker_code,
        file_content=content,
        filename=file.filename or 'upload',
        confirmed_mappings=mappings,
        skipped_accounts=skipped
    )
    return result


@router.get("/batches")
def get_import_batches(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all import batches for the current user."""
    result = db.execute(
        text("""
            SELECT ib.*, b.name as broker_name
            FROM import_batches ib
            JOIN brokers b ON ib.broker_code = b.code
            WHERE ib.owner_id = :owner_id
            ORDER BY ib.created_at DESC
            LIMIT 50
        """),
        {'owner_id': str(current_user.id)}
    ).fetchall()
    return [dict(r._mapping) for r in result]


@router.delete("/batches/{batch_id}")
def delete_import_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Delete an import batch and all its transactions, then recalculate holdings."""
    batch = db.execute(
        text("SELECT id FROM import_batches WHERE id = :id AND owner_id = :owner_id"),
        {'id': batch_id, 'owner_id': str(current_user.id)}
    ).fetchone()

    if not batch:
        raise HTTPException(status_code=404, detail="Import batch not found")

    affected = db.execute(
        text("SELECT DISTINCT account_id FROM transactions WHERE import_batch_id = :id"),
        {'id': batch_id}
    ).fetchall()
    affected_ids = [str(r.account_id) for r in affected]

    db.execute(text("DELETE FROM transactions WHERE import_batch_id = :id"), {'id': batch_id})
    db.execute(text("DELETE FROM import_batches WHERE id = :id"), {'id': batch_id})
    db.commit()

    from app.services.acb_service import recalculate_holdings_for_accounts
    recalculate_holdings_for_accounts(db, affected_ids)

    return {"message": "Import batch deleted and holdings recalculated"}