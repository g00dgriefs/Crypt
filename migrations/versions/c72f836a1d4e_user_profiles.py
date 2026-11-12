"""Add profile fields to users

Revision ID: c72f836a1d4e
Revises: b74d1a2c9e10
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa


revision = "c72f836a1d4e"
down_revision = "b74d1a2c9e10"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user", sa.Column("bio", sa.String(length=500), nullable=False, server_default=""))
    op.add_column("user", sa.Column("profile_picture", sa.Text(), nullable=True))
    op.alter_column("user", "bio", server_default=None)


def downgrade():
    op.drop_column("user", "profile_picture")
    op.drop_column("user", "bio")
