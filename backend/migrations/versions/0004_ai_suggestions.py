"""ai_suggestions table for B8 automation (tag/link/summary)

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_suggestions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.String(length=36), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("type IN ('tag', 'link', 'summary')", name="type"),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'rejected')", name="status"),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_suggestions_status_created_at", "ai_suggestions", ["status", "created_at"]
    )
    op.create_index("ix_ai_suggestions_item_id", "ai_suggestions", ["item_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_suggestions_item_id", table_name="ai_suggestions")
    op.drop_index("ix_ai_suggestions_status_created_at", table_name="ai_suggestions")
    op.drop_table("ai_suggestions")
