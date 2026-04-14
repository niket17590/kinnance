from sqlalchemy.orm import Session
from sqlalchemy import text
from uuid import UUID
from datetime import date
import json
import logging

from app.parsers.base_parser import ParseResult
from app.parsers.wealthsimple_parser import WealthSimpleParser
from app.parsers.questrade_parser import QuestradeParser
from app.parsers.ibkr_parser import IBKRParser

logger = logging.getLogger(__name__)


# ============================================================
# PARSERS
# ============================================================

def get_parser(broker_code: str):
    parsers = {
        "WEALTHSIMPLE": WealthSimpleParser,
        "QUESTRADE":    QuestradeParser,
        "IBKR":         IBKRParser,
    }
    cls = parsers.get(broker_code.upper())
    if not cls:
        raise ValueError(f"No parser available for broker: {broker_code}")
    return cls()


def parse_file(broker_code: str, file_content: bytes, filename: str) -> ParseResult:
    parser = get_parser(broker_code)
    return parser.parse(file_content, filename)


# ============================================================
# ACCOUNT MAPPING
# ============================================================

def get_saved_mapping(
    db: Session, owner_id: UUID, broker_code: str, identifier: str
) -> dict | None:
    result = db.execute(
        text("""
            SELECT
                bam.account_id,
                ma.account_type_code,
                ma.member_id,
                m.display_name as member_name,
                at.name as account_type_name
            FROM broker_account_mappings bam
            JOIN member_accounts ma ON bam.account_id = ma.id
            JOIN members m ON ma.member_id = m.id
            JOIN account_types at ON ma.account_type_code = at.code
            WHERE bam.broker_code = :broker_code
            AND bam.broker_account_identifier = :identifier
            AND m.owner_id = :owner_id
        """),
        {"broker_code": broker_code, "identifier": identifier, "owner_id": str(owner_id)},
    ).fetchone()
    return dict(result._mapping) if result else None


def save_account_mapping(
    db: Session, account_id: UUID, broker_code: str, identifier: str
):
    db.execute(
        text("""
            INSERT INTO broker_account_mappings
                (account_id, broker_code, broker_account_identifier)
            VALUES (:account_id, :broker_code, :identifier)
            ON CONFLICT (broker_code, broker_account_identifier) DO NOTHING
        """),
        {"account_id": str(account_id), "broker_code": broker_code, "identifier": identifier},
    )


def get_available_accounts(
    db: Session, owner_id: UUID, broker_code: str, member_id: str = None
) -> list:
    if member_id:
        rows = db.execute(
            text("""
                SELECT
                    ma.id, ma.account_type_code,
                    ma.nickname, ma.broker_code,
                    m.display_name as member_name,
                    at.name as account_type_name
                FROM member_accounts ma
                JOIN members m ON ma.member_id = m.id
                JOIN account_types at ON ma.account_type_code = at.code
                WHERE m.owner_id = :owner_id
                AND ma.broker_code = :broker_code
                AND ma.member_id::text = :member_id
                AND ma.is_active = TRUE
                ORDER BY ma.account_type_code
            """),
            {"owner_id": str(owner_id), "broker_code": broker_code, "member_id": str(member_id)},
        ).fetchall()
    else:
        rows = db.execute(
            text("""
                SELECT
                    ma.id, ma.account_type_code,
                    ma.nickname, ma.broker_code,
                    m.display_name as member_name,
                    at.name as account_type_name
                FROM member_accounts ma
                JOIN members m ON ma.member_id = m.id
                JOIN account_types at ON ma.account_type_code = at.code
                WHERE m.owner_id = :owner_id
                AND ma.broker_code = :broker_code
                AND ma.is_active = TRUE
                ORDER BY m.display_name, ma.account_type_code
            """),
            {"owner_id": str(owner_id), "broker_code": broker_code},
        ).fetchall()
    return [dict(r._mapping) for r in rows]


# ============================================================
# IMPORT BATCH
# ============================================================

def create_import_batch(
    db: Session, owner_id: UUID, broker_code: str, filename: str
) -> str:
    result = db.execute(
        text("""
            INSERT INTO import_batches (owner_id, broker_code, filename, status)
            VALUES (:owner_id, :broker_code, :filename, 'PROCESSING')
            RETURNING id
        """),
        {"owner_id": str(owner_id), "broker_code": broker_code, "filename": filename},
    ).fetchone()
    db.commit()
    return str(result.id)


def update_import_batch(
    db: Session,
    batch_id: str,
    status: str,
    rows_total: int = 0,
    rows_imported: int = 0,
    rows_duplicate_skipped: int = 0,
    rows_account_skipped: int = 0,
    error_message: str = None,
    transaction_date_from: date = None,
    transaction_date_to: date = None,
):
    db.execute(
        text("""
            UPDATE import_batches SET
                status = :status,
                rows_total = :total,
                rows_imported = :imported,
                rows_duplicate_skipped = :dup_skipped,
                rows_account_skipped = :acc_skipped,
                error_message = :error,
                transaction_date_from = :date_from,
                transaction_date_to = :date_to,
                imported_at = NOW()
            WHERE id = :id
        """),
        {
            "id": batch_id,
            "status": status,
            "total": rows_total,
            "imported": rows_imported,
            "dup_skipped": rows_duplicate_skipped,
            "acc_skipped": rows_account_skipped,
            "error": error_message,
            "date_from": transaction_date_from,
            "date_to": transaction_date_to,
        },
    )
    db.commit()


# ============================================================
# STEP 1 — PARSE AND CHECK MAPPINGS
# ============================================================

def parse_and_match(
    db: Session,
    owner_id: UUID,
    broker_code: str,
    file_content: bytes,
    filename: str,
    member_id: str = None,
) -> dict:
    """
    Parse the uploaded file and check broker_account_mappings.
    Returns READY or NEEDS_MAPPING status.
    No transactions are inserted here.
    """
    parse_result = parse_file(broker_code, file_content, filename)

    if not parse_result.transactions and parse_result.errors:
        return {"status": "FAILED", "errors": parse_result.errors}

    matched_accounts = {}
    unmatched = []
    account_number_suggestions = {}

    for identifier in parse_result.broker_accounts_found:
        saved = get_saved_mapping(db, owner_id, broker_code, identifier)
        if saved:
            matched_accounts[identifier] = {
                "account_id": str(saved["account_id"]),
                "account_type_code": saved["account_type_code"],
                "account_type_name": saved["account_type_name"],
                "member_name": saved["member_name"],
            }
        else:
            unmatched.append(identifier)
            # Suggest by account_number match
            suggestion = db.execute(
                text("""
                    SELECT ma.id
                    FROM member_accounts ma
                    JOIN members m ON ma.member_id = m.id
                    WHERE m.owner_id = :owner_id
                    AND ma.broker_code = :broker_code
                    AND ma.account_number = :identifier
                    AND ma.is_active = TRUE
                    LIMIT 1
                """),
                {"owner_id": str(owner_id), "broker_code": broker_code, "identifier": identifier},
            ).fetchone()
            if suggestion:
                account_number_suggestions[identifier] = str(suggestion.id)

    available_accounts = get_available_accounts(db, owner_id, broker_code, member_id)

    if unmatched:
        return {
            "status": "NEEDS_MAPPING",
            "transactions_found": len(parse_result.transactions),
            "broker_accounts_found": parse_result.broker_accounts_found,
            "unmatched_accounts": unmatched,
            "matched_accounts": matched_accounts,
            "available_accounts": available_accounts,
            "account_number_suggestions": account_number_suggestions,
            "errors": parse_result.errors[:10],
        }

    return {
        "status": "READY",
        "transactions_found": len(parse_result.transactions),
        "broker_accounts_found": parse_result.broker_accounts_found,
        "matched_accounts": matched_accounts,
        "available_accounts": available_accounts,
        "errors": parse_result.errors[:10],
    }


# ============================================================
# STEP 2 — IMPORT TRANSACTIONS
# Bulk optimised: one duplicate check query, one bulk INSERT, one commit.
# ============================================================

def import_transactions(
    db: Session,
    owner_id: UUID,
    broker_code: str,
    file_content: bytes,
    filename: str,
    confirmed_mappings: dict,
    skipped_accounts: list,
) -> dict:
    """
    Import parsed transactions into DB.

    Performance optimisations vs previous version:
    1. Pre-fetch ALL existing hashes for affected accounts in ONE query
       → duplicate check is Python set lookup (O(1)) per transaction
       → was: 1 SELECT per transaction in loop
    2. Collect all valid rows → single executemany INSERT → single commit
       → was: 1 execute + 1 commit per transaction
    3. Atomic batch: all inserts succeed or all roll back

    Duplicate semantics preserved:
      same hash + different import_batch_id = duplicate (skipped)
      same hash + same import_batch_id = current batch (allowed, won't happen in practice)
    """
    parse_result = parse_file(broker_code, file_content, filename)

    if not parse_result.transactions and parse_result.errors:
        raise Exception(f"Parse failed: {'; '.join(parse_result.errors[:3])}")

    batch_id = create_import_batch(db, owner_id, broker_code, filename)

    try:
        # ── Resolve canonical symbols for bare CAD tickers ────
        # e.g. QESS → QESS.CN via Twelve Data symbol_search
        from app.services.price_service import resolve_canonical_symbol, _is_canadian
        for txn in parse_result.transactions:
            if (txn.symbol_normalized
                    and txn.trade_currency == 'CAD'
                    and not _is_canadian(txn.symbol_normalized)):
                canonical = resolve_canonical_symbol(db, txn.symbol_normalized, 'CAD')
                if canonical != txn.symbol_normalized:
                    logger.info(f"Symbol resolved: {txn.symbol_normalized} → {canonical}")
                    txn.symbol_normalized = canonical
                    
        # ── Build account mapping ─────────────────────────────
        account_mapping = {}

        for identifier in parse_result.broker_accounts_found:
            if identifier in skipped_accounts:
                continue
            saved = get_saved_mapping(db, owner_id, broker_code, identifier)
            if saved:
                account_mapping[identifier] = str(saved["account_id"])

        for identifier, account_id_str in confirmed_mappings.items():
            if not account_id_str or identifier in skipped_accounts:
                continue
            account_mapping[identifier] = account_id_str
            try:
                save_account_mapping(db, UUID(account_id_str), broker_code, identifier)
                db.commit()
            except Exception:
                db.rollback()

        # ── Count skipped accounts ────────────────────────────
        accounts_skipped = sum(
            1 for t in parse_result.transactions
            if t.broker_account_identifier in skipped_accounts
        )

        # ── Pre-compute all hashes for this file ──────────────
        # Build map: hash → (txn, account_id_str) for non-skipped, mapped transactions
        candidate_map: dict[str, tuple] = {}
        unmapped_errors = []

        for txn in parse_result.transactions:
            if txn.broker_account_identifier in skipped_accounts:
                continue
            account_id_str = account_mapping.get(txn.broker_account_identifier)
            if not account_id_str:
                unmapped_errors.append(txn.broker_account_identifier)
                continue
            h = txn.compute_hash()
            candidate_map[h] = (txn, account_id_str)

        if unmapped_errors:
            raise Exception(
                f"Account '{unmapped_errors[0]}' has no mapping. "
                f"Please go back and map or skip all accounts."
            )

        if not candidate_map:
            update_import_batch(db, batch_id, "COMPLETE",
                rows_total=len(parse_result.transactions),
                rows_account_skipped=accounts_skipped)
            return {
                "status": "COMPLETE", "batch_id": batch_id,
                "total_transactions": len(parse_result.transactions),
                "imported": 0, "duplicates_skipped": 0,
                "accounts_skipped": accounts_skipped,
                "date_from": None, "date_to": None,
                "parse_errors": parse_result.errors[:10],
                "imported_symbols": [], "renamed_symbols": {},
            }

        # ── Bulk duplicate check — ONE query for all hashes ───
        # Fetch hashes that already exist in transactions from a DIFFERENT batch
        all_candidate_hashes = list(candidate_map.keys())

        existing_hashes: set[str] = set()
        if all_candidate_hashes:
            # Split into chunks of 1000 to avoid parameter limits
            chunk_size = 1000
            for i in range(0, len(all_candidate_hashes), chunk_size):
                chunk = all_candidate_hashes[i:i + chunk_size]
                rows = db.execute(
                    text("""
                        SELECT import_hash
                        FROM transactions
                        WHERE import_hash = ANY(CAST(:hashes AS text[]))
                        AND import_batch_id != :batch_id
                    """),
                    {"hashes": chunk, "batch_id": str(batch_id)}
                ).fetchall()
                existing_hashes.update(r.import_hash for r in rows)

        logger.info(
            f"Duplicate check: {len(all_candidate_hashes)} candidates, "
            f"{len(existing_hashes)} duplicates found (batch {batch_id})"
        )

        # ── Separate duplicates from new transactions ─────────
        duplicates_skipped = 0
        rows_to_insert = []
        dates = []

        for h, (txn, account_id_str) in candidate_map.items():
            if h in existing_hashes:
                duplicates_skipped += 1
                logger.info(
                    f"Duplicate skipped: {txn.transaction_type} "
                    f"{txn.symbol_normalized or ''} "
                    f"{txn.trade_date} "
                    f"qty={txn.quantity} "
                    f"net={txn.net_amount} "
                    f"currency={txn.trade_currency} "
                    f"account={txn.broker_account_identifier}"
                )
                continue

            raw_data_json = json.dumps(txn.raw_data) if txn.raw_data else None
            rows_to_insert.append({
                "account_id":    account_id_str,
                "batch_id":      batch_id,
                "txn_type":      txn.transaction_type,
                "trade_date":    txn.trade_date,
                "settlement_date": txn.settlement_date,
                "symbol":        txn.symbol,
                "symbol_norm":   txn.symbol_normalized,
                "asset_type":    txn.asset_type,
                "description":   txn.description,
                "quantity":      str(txn.quantity) if txn.quantity else None,
                "price":         str(txn.price_per_unit) if txn.price_per_unit else None,
                "currency":      txn.trade_currency,
                "gross":         str(txn.gross_amount) if txn.gross_amount else None,
                "commission":    str(txn.commission),
                "net_amount":    str(txn.net_amount),
                "net_cad":       str(txn.net_amount_cad),
                "fx_rate":       str(txn.fx_rate_to_cad) if txn.fx_rate_to_cad else None,
                "hash":          h,
                "raw_data":      raw_data_json,
                "notes":         txn.notes,
            })
            if txn.trade_date:
                dates.append(txn.trade_date)

        imported = len(rows_to_insert)

        # ── Bulk INSERT — single executemany + single commit ──
        if rows_to_insert:
            db.execute(
                text("""
                    INSERT INTO transactions (
                        account_id, import_batch_id,
                        transaction_type, trade_date, settlement_date,
                        symbol, symbol_normalized, asset_type, description,
                        quantity, price_per_unit,
                        trade_currency, gross_amount, commission,
                        net_amount, net_amount_cad, fx_rate_to_cad,
                        import_hash, raw_data, notes
                    ) VALUES (
                        :account_id, :batch_id,
                        :txn_type, :trade_date, :settlement_date,
                        :symbol, :symbol_norm, :asset_type, :description,
                        :quantity, :price,
                        :currency, :gross, :commission,
                        :net_amount, :net_cad, :fx_rate,
                        :hash, cast(:raw_data as jsonb), :notes
                    )
                """),
                rows_to_insert  # executemany — SQLAlchemy handles list of dicts
            )
            db.commit()
            logger.info(f"Bulk inserted {imported} transactions for batch {batch_id}")

        # ── Update batch record ───────────────────────────────
        date_from = min(dates) if dates else None
        date_to   = max(dates) if dates else None
        total_transactions = len(parse_result.transactions)

        update_import_batch(
            db, batch_id, "COMPLETE",
            rows_total=total_transactions,
            rows_imported=imported,
            rows_duplicate_skipped=duplicates_skipped,
            rows_account_skipped=accounts_skipped,
            transaction_date_from=date_from,
            transaction_date_to=date_to,
        )

        # ── Recalculate portfolio ─────────────────────────────
        if imported > 0:
            affected_ids = list(set(account_mapping.values()))
            from app.services.acb_service import recalculate_portfolio

            affected_member_rows = db.execute(
                text("""
                    SELECT DISTINCT member_id
                    FROM member_accounts
                    WHERE id = ANY(CAST(:ids AS uuid[]))
                """),
                {"ids": affected_ids}
            ).fetchall()
            affected_member_ids = [str(r.member_id) for r in affected_member_rows]

            # Resolve circle_ids for rebalancer cleanup
            circle_rows = db.execute(
                text("""
                    SELECT DISTINCT ca.circle_id
                    FROM circle_accounts ca
                    WHERE ca.account_id = ANY(CAST(:ids AS uuid[]))
                """),
                {"ids": affected_ids}
            ).fetchall()
            affected_circle_ids = [str(r.circle_id) for r in circle_rows]

            recalculate_portfolio(db, affected_ids, affected_member_ids, affected_circle_ids)

        # ── Collect symbols for price fetching ────────────────
        imported_symbols = list(set(
            t.symbol_normalized
            for t in parse_result.transactions
            if t.symbol_normalized
            and t.transaction_type in ('BUY', 'SELL')
            and t.broker_account_identifier not in skipped_accounts
        ))

        # ── Collect symbol renames ────────────────────────────
        renamed_symbols = {}
        for t in parse_result.transactions:
            if (t.transaction_type == 'CORPORATE_ACTION'
                    and t.notes
                    and t.notes.startswith('RENAME_FROM:')
                    and t.symbol_normalized
                    and t.broker_account_identifier not in skipped_accounts):
                old_sym = t.notes.split('RENAME_FROM:', 1)[1].strip()
                renamed_symbols[old_sym] = t.symbol_normalized
                if t.symbol_normalized not in imported_symbols:
                    imported_symbols.append(t.symbol_normalized)

        return {
            "status": "COMPLETE",
            "batch_id": batch_id,
            "total_transactions": total_transactions,
            "imported": imported,
            "duplicates_skipped": duplicates_skipped,
            "accounts_skipped": accounts_skipped,
            "date_from": str(date_from) if date_from else None,
            "date_to": str(date_to) if date_to else None,
            "parse_errors": parse_result.errors[:10],
            "imported_symbols": imported_symbols,
            "renamed_symbols": renamed_symbols,
        }

    except Exception as e:
        db.rollback()
        try:
            update_import_batch(db, batch_id, "FAILED", error_message=str(e)[:500])
        except Exception:
            pass
        raise
