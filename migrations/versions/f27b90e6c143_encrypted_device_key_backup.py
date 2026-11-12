"""Store encrypted device key backups

Revision ID: f27b90e6c143
Revises: e48a91b72dc4
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa


revision = "f27b90e6c143"
down_revision = "e48a91b72dc4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user", sa.Column("encrypted_key_backup", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("user", "encrypted_key_backup")
