from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# Create database engine
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,    # checks connection is alive before using it
    pool_size=10,          # max 10 connections in pool
    max_overflow=20        # allow 20 extra connections if pool is full
)

# Session factory — creates new DB sessions
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base class for all SQLAlchemy models
Base = declarative_base()

def get_db():
    """
    Dependency function — used in every API endpoint that needs DB access.
    Automatically closes the session when request is done.
    Java equivalent: @Transactional — opens and closes DB session per request
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()