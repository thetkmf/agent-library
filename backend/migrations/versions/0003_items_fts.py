"""items FTS5 index for keyword search (B6)

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-24

关键字检索使用 FTS5 虚表 ``items_fts``：
- tokenizer 用 ``trigram``，对中文也能做子串匹配（查询词 ≥3 字符走 FTS，短词由服务层回退 LIKE）。
- 用触发器保持与 ``items`` 同步，业务代码不需要额外写入点。
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CREATE_SQL = [
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
        item_id UNINDEXED,
        title,
        content,
        tokenize = 'trigram'
    )
    """,
    "INSERT INTO items_fts(rowid, item_id, title, content) "
    "SELECT rowid, id, title, coalesce(content, '') FROM items",
    """
    CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON items BEGIN
        INSERT INTO items_fts(rowid, item_id, title, content)
        VALUES (new.rowid, new.id, new.title, coalesce(new.content, ''));
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON items BEGIN
        DELETE FROM items_fts WHERE rowid = old.rowid;
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE ON items BEGIN
        UPDATE items_fts
        SET item_id = new.id, title = new.title, content = coalesce(new.content, '')
        WHERE rowid = new.rowid;
    END
    """,
]

DROP_SQL = [
    "DROP TRIGGER IF EXISTS items_fts_au",
    "DROP TRIGGER IF EXISTS items_fts_ad",
    "DROP TRIGGER IF EXISTS items_fts_ai",
    "DROP TABLE IF EXISTS items_fts",
]


def upgrade() -> None:
    for statement in CREATE_SQL:
        op.execute(statement)


def downgrade() -> None:
    for statement in DROP_SQL:
        op.execute(statement)
