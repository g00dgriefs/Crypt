"""Add friend requests

Revision ID: b74d1a2c9e10
Revises: a3ca953b2fa4
Create Date: 2026-11-09
"""
from alembic import op
import sqlalchemy as sa


revision = "b74d1a2c9e10"
down_revision = "a3ca953b2fa4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "friend_request",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("requester_id", sa.Integer(), nullable=False),
        sa.Column("addressee_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("requester_id != addressee_id", name="ck_friend_request_not_self"),
        sa.ForeignKeyConstraint(["addressee_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["requester_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("requester_id", "addressee_id", name="uq_friend_request_pair"),
    )
    op.create_index("ix_friend_request_requester_id", "friend_request", ["requester_id"])
    op.create_index("ix_friend_request_addressee_id", "friend_request", ["addressee_id"])


def downgrade():
    op.drop_index("ix_friend_request_addressee_id", table_name="friend_request")
    op.drop_index("ix_friend_request_requester_id", table_name="friend_request")
    op.drop_table("friend_request")
