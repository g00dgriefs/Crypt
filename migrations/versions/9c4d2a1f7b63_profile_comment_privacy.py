"""Add profile comment privacy setting

Revision ID: 9c4d2a1f7b63
Revises: 81c5d0a3b264
Create Date: 2026-11-16
"""
from alembic import op
import sqlalchemy as sa


revision = "9c4d2a1f7b63"
down_revision = "81c5d0a3b264"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user",
        sa.Column("allow_profile_comments", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade():
    op.drop_column("user", "allow_profile_comments")
