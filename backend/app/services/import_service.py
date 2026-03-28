from sqlalchemy.orm import Session
from sqlalchemy import text
from uuid import UUID
from datetime import date
import json

from app.parsers.base_parser import ParseResult
from app.parsers.wealthsimple_parser import WealthSimpleParser
from app.parsers.questrade_parser import QuestradeParser
from app.parsers.ibkr_parser import IBKRParser


# ============================================================
# PARSERS
# ============================================================

def get_parser(broker_code: str):
    parsers = {
        'WEALTHSIMPLE': WealthSimpleParser,
        'QUESTRADE': QuestradeParser,
        'IBKR': IBKRParser,
    }
    cls = parsers.get(broker_code.upper())
    if not cls:
        raise ValueError(f"No parser available for broker: {broker_code}")
    return cls()


def parse_file(broker_code: str, file_content: bytes, filename: str) -> ParseResult:
    parser = get_parser(broker_code)
    return parser.parse(file_content, filename)


# ============================================================
# ACCOUNT MATCHING
# ============================================================

def get_saved_mapping(db: Session, owner_id: UUID, broker_code: str, identifier: str) -> dict | None:
    """Check if we have a saved mapping for this broker identifier."""
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
        {
            'broker_code': broker_code,
            'identifier': identifier,
            'owner_id': str(owner_id)
        }
    ).fetchone()
    return dict(result._mapping) if result else None


def try_auto_match(
    db: Session,
    owner_id: UUID,
    broker_code: str,
    identifier: str,
    account_type_code: str = None
) -> dict | None:
    """Auto-match by account type (WS/Questrade only — never IBKR)."""
    if account_type_code and account_type_code != 'CRYPTO' and broker_code != 'IBKR':
        result = db.execute(
            text("""
                SELECT
                    ma.id as account_id,
                    ma.account_type_code,
                    ma.member_id,
                    m.display_name as member_name,
                    at.name as account_type_name
                FROM member_accounts ma
                JOIN members m ON ma.member_id = m.id
                JOIN account_types at ON ma.account_type_code = at.code
                WHERE m.owner_id = :owner_id
                AND ma.broker_code = :broker_code
                AND ma.account_type_code = :account_type_code
                AND ma.is_active = TRUE
                LIMIT 1
            """),
            {
                'owner_id': str(owner_id),
                'broker_code': broker_code,
                'account_type_code': account_type_code
            }
        ).fetchone()
        if result:
            return dict(result._mapping)

    # Also try matching by account number (Questrade)
    result = db.execute(
        text("""
            SELECT
                ma.id as account_id,
                ma.account_type_code,
                ma.member_id,
                m.display_name as member_name,
                at.name as account_type_name
            FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            JOIN account_types at ON ma.account_type_code = at.code
            WHERE m.owner_id = :owner_id
            AND ma.broker_code = :broker_code
            AND ma.account_number = :identifier
            AND ma.is_active = TRUE
            LIMIT 1
        """),
        {
            'owner_id': str(owner_id),
            'broker_code': broker_code,
            'identifier': identifier
        }
    ).fetchone()
    return dict(result._mapping) if result else None


def save_account_mapping(db: Session, account_id: UUID, broker_code: str, identifier: str):
    """Persist a broker identifier -> account mapping."""
    db.execute(
        text("""
            INSERT INTO broker_account_mappings
                (account_id, broker_code, broker_account_identifier)
            VALUES (:account_id, :broker_code, :identifier)
            ON CONFLICT (broker_code, broker_account_identifier) DO NOTHING
        """),
        {
            'account_id': str(account_id),
            'broker_code': broker_code,
            'identifier': identifier
        }
    )


def get_available_accounts(
    db: Session, owner_id: UUID, broker_code: str, member_id: str = None
) -> list:
    """Get all Kinnance accounts for this owner + broker."""
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
                ORDER BY m.display_name, ma.account_type_code
            """),
            {'owner_id': str(owner_id), 'broker_code': broker_code, 'member_id': str(member_id)}
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
            {'owner_id': str(owner_id), 'broker_code': broker_code}
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
        {'owner_id': str(owner_id), 'broker_code': broker_code, 'filename': filename}
    ).fetchone()
    db.commit()
    return str(result.id)


def update_import_batch(
    db: Session, batch_id: str, status: str,
    rows_total: int = 0, rows_imported: int = 0,
    rows_duplicate_skipped: int = 0, rows_account_skipped: int = 0,
    error_message: str = None,
    transaction_date_from: date = None,
    transaction_date_to: date = None
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
            'id': batch_id, 'status': status,
            'total': rows_total, 'imported': rows_imported,
            'dup_skipped': rows_duplicate_skipped,
            'acc_skipped': rows_account_skipped,
            'error': error_message,
            'date_from': transaction_date_from,
            'date_to': transaction_date_to
        }
    )
    db.commit()


# ============================================================
# STEP 1 — PARSE AND MATCH (no importing)
# ============================================================

def parse_and_match(
    db: Session,
    owner_id: UUID,
    broker_code: str,
    file_content: bytes,
    filename: str,
    member_id: str = None
) -> dict:
    """
    Parse the file and determine account mapping.
    Does NOT insert any transactions.

    Returns:
      status=NEEDS_MAPPING  — some accounts need user input
      status=READY          — all accounts matched, ready to import
      status=FAILED         — parse error
    """
    parse_result = parse_file(broker_code, file_content, filename)

    if not parse_result.transactions and parse_result.errors:
        return {'status': 'FAILED', 'errors': parse_result.errors}

    auto_matched = []
    unmatched = []

    for identifier in parse_result.broker_accounts_found:
        # Check saved mappings first
        saved = get_saved_mapping(db, owner_id, broker_code, identifier)
        if saved:
            auto_matched.append(identifier)
            continue

        # Try auto-match by type
        type_hint = parse_result.broker_account_types.get(identifier)
        auto = try_auto_match(db, owner_id, broker_code, identifier, type_hint)
        if auto:
            auto_matched.append(identifier)
            try:
                save_account_mapping(db, UUID(str(auto['account_id'])), broker_code, identifier)
                db.commit()
            except Exception:
                db.rollback()
            continue

        unmatched.append(identifier)

    total = len(parse_result.transactions)
    dates = [t.trade_date for t in parse_result.transactions if t.trade_date]
    date_from = str(min(dates)) if dates else None
    date_to = str(max(dates)) if dates else None

    if unmatched:
        available = get_available_accounts(db, owner_id, broker_code, member_id)
        return {
            'status': 'NEEDS_MAPPING',
            'unmatched_accounts': unmatched,
            'auto_matched_accounts': auto_matched,
            'available_accounts': available,
            'total_transactions': total,
            'date_from': date_from,
            'date_to': date_to,
            'parse_errors': parse_result.errors[:10]
        }

    return {
        'status': 'READY',
        'auto_matched_accounts': auto_matched,
        'unmatched_accounts': [],
        'total_transactions': total,
        'date_from': date_from,
        'date_to': date_to,
        'parse_errors': parse_result.errors[:10]
    }


# ============================================================
# STEP 2 — RUN IMPORT
# UI sends confirmed_mappings + skipped_accounts explicitly
# ============================================================

def run_import(
    db: Session,
    owner_id: UUID,
    broker_code: str,
    file_content: bytes,
    filename: str,
    confirmed_mappings: dict,
    skipped_accounts: list
) -> dict:
    """
    Import transactions.

    confirmed_mappings: {broker_identifier: kinnance_account_id}
    skipped_accounts:   [broker_identifier, ...]

    Returns 5 clear counts:
      total_transactions  — all rows parsed from file
      imported            — new records inserted into DB
      duplicates_skipped  — already existed in DB
      accounts_skipped    — from accounts user chose to skip
      failed              — errors during insert
    """
    batch_id = create_import_batch(db, owner_id, broker_code, filename)

    try:
        parse_result = parse_file(broker_code, file_content, filename)

        if not parse_result.transactions and parse_result.errors:
            update_import_batch(db, batch_id, 'FAILED',
                                error_message='; '.join(parse_result.errors[:5]))
            return {'status': 'FAILED', 'errors': parse_result.errors}

        total_transactions = len(parse_result.transactions)

        # Build account mapping:
        # Start with auto-matching, then add user confirmed mappings
        account_mapping = {}

        for identifier in parse_result.broker_accounts_found:
            if identifier in skipped_accounts:
                continue

            # Check saved mappings
            saved = get_saved_mapping(db, owner_id, broker_code, identifier)
            if saved:
                account_mapping[identifier] = str(saved['account_id'])
                continue

           # Try auto-match
            type_hint = parse_result.broker_account_types.get(identifier)
            auto = try_auto_match(db, owner_id, broker_code, identifier, type_hint)
            if auto:
                account_mapping[identifier] = str(auto['account_id'])
                try:
                    save_account_mapping(db, UUID(str(auto['account_id'])), broker_code, identifier)
                    db.commit()
                except Exception:
                    db.rollback()

        # Add user confirmed mappings and persist them
        for identifier, account_id_str in confirmed_mappings.items():
            if not account_id_str or identifier in skipped_accounts:
                continue
            account_mapping[identifier] = account_id_str
            try:
                save_account_mapping(db, UUID(account_id_str), broker_code, identifier)
                db.commit()
            except Exception:
                db.rollback()

        # Count how many transactions belong to skipped accounts
        accounts_skipped = sum(
            1 for t in parse_result.transactions
            if t.broker_account_identifier in skipped_accounts
        )

        # Process remaining transactions
        imported = 0
        duplicates_skipped = 0
        dates = []

        for txn in parse_result.transactions:
            # Skip user-skipped accounts
            if txn.broker_account_identifier in skipped_accounts:
                continue

            # Unmapped account — should not happen if parse_and_match ran correctly
            account_id_str = account_mapping.get(txn.broker_account_identifier)
            if not account_id_str:
                raise Exception(
                    f"Account '{txn.broker_account_identifier}' could not be mapped. "
                    f"Please go back and map or skip all accounts."
                )

            import_hash = txn.compute_hash()

            # Check for duplicate
            existing = db.execute(
                text("SELECT id FROM transactions WHERE import_hash = :hash"),
                {'hash': import_hash}
            ).fetchone()

            if existing:
                duplicates_skipped += 1
                continue

            # Insert
            try:
                raw_data_json = json.dumps(txn.raw_data) if txn.raw_data else None
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
                    {
                        'account_id': account_id_str,
                        'batch_id': batch_id,
                        'txn_type': txn.transaction_type,
                        'trade_date': txn.trade_date,
                        'settlement_date': txn.settlement_date,
                        'symbol': txn.symbol,
                        'symbol_norm': txn.symbol_normalized,
                        'asset_type': txn.asset_type,
                        'description': txn.description,
                        'quantity': str(txn.quantity) if txn.quantity else None,
                        'price': str(txn.price_per_unit) if txn.price_per_unit else None,
                        'currency': txn.trade_currency,
                        'gross': str(txn.gross_amount) if txn.gross_amount else None,
                        'commission': str(txn.commission),
                        'net_amount': str(txn.net_amount),
                        'net_cad': str(txn.net_amount_cad),
                        'fx_rate': str(txn.fx_rate_to_cad) if txn.fx_rate_to_cad else None,
                        'hash': import_hash,
                        'raw_data': raw_data_json,
                        'notes': txn.notes
                    }
                )
                db.commit()

                if txn.trade_date:
                    dates.append(txn.trade_date)
                imported += 1

            except Exception as e:
                db.rollback()
                raise Exception(f"Failed to insert transaction on {txn.trade_date}: {str(e)[:200]}")

        date_from = min(dates) if dates else None
        date_to = max(dates) if dates else None

        update_import_batch(
            db, batch_id, 'COMPLETE',
            rows_total=total_transactions,
            rows_imported=imported,
            rows_duplicate_skipped=duplicates_skipped,
            rows_account_skipped=accounts_skipped,
            transaction_date_from=date_from,
            transaction_date_to=date_to
        )

        # Recalculate holdings for affected accounts
        if imported > 0:
            affected_ids = list(set(account_mapping.values()))
            from app.services.acb_service import recalculate_holdings_for_accounts
            recalculate_holdings_for_accounts(db, affected_ids)

        return {
            'status': 'COMPLETE',
            'batch_id': batch_id,
            'total_transactions': total_transactions,
            'imported': imported,
            'duplicates_skipped': duplicates_skipped,
            'accounts_skipped': accounts_skipped,
            'date_from': str(date_from) if date_from else None,
            'date_to': str(date_to) if date_to else None,
            'parse_errors': parse_result.errors[:10]
        }

    except Exception as e:
        db.rollback()
        try:
            update_import_batch(db, batch_id, 'FAILED', error_message=str(e)[:500])
        except Exception:
            pass
        raise