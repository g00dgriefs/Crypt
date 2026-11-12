"""Add display names and unique username identifiers

Revision ID: e48a91b72dc4
Revises: c72f836a1d4e
Create Date: 2026-11-10
"""
import secrets

from alembic import op
import sqlalchemy as sa


revision = "e48a91b72dc4"
down_revision = "c72f836a1d4e"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user",
        sa.Column("display_name", sa.String(length=32), nullable=False, server_default="Crypt User"),
    )
    op.add_column("user", sa.Column("identifier", sa.Integer(), nullable=True))

    user_table = sa.table(
        "user",
        sa.column("id", sa.Integer()),
        sa.column("username", sa.String()),
        sa.column("identifier", sa.Integer()),
    )
    connection = op.get_bind()
    usernames = connection.execute(sa.select(user_table.c.id, user_table.c.username)).all()
    used_identifiers = {}
    for user_id, username in usernames:
        normalized_username = username.lower()
        used_for_name = used_identifiers.setdefault(normalized_username, set())
        identifier = secrets.randbelow(9000) + 1000
        while identifier in used_for_name:
            identifier = secrets.randbelow(9000) + 1000
        used_for_name.add(identifier)
        connection.execute(
            user_table.update().where(user_table.c.id == user_id).values(identifier=identifier)
        )

    op.alter_column("user", "identifier", nullable=False)
    op.alter_column("user", "display_name", server_default=None)
    op.drop_index("ix_user_username", table_name="user")
    op.create_index("ix_user_username", "user", ["username"], unique=False)
    op.create_index(
        "uq_user_username_identifier",
        "user",
        [sa.text("lower(username)"), "identifier"],
        unique=True,
    )


def downgrade():
    op.drop_index("uq_user_username_identifier", table_name="user")
    op.drop_index("ix_user_username", table_name="user")
    op.create_index("ix_user_username", "user", ["username"], unique=True)
    op.drop_column("user", "identifier")
    op.drop_column("user", "display_name")
