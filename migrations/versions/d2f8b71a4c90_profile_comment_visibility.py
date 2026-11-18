"""Add profile comment visibility levels

Revision ID: d2f8b71a4c90
Revises: 9c4d2a1f7b63
Create Date: 2026-11-18
"""
from alembic import op
import sqlalchemy as sa


revision = "d2f8b71a4c90"
down_revision = "9c4d2a1f7b63"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user",
        sa.Column("profile_comment_visibility", sa.String(length=16), nullable=True),
    )
    op.execute(
        'UPDATE "user" SET profile_comment_visibility = '
        "CASE WHEN allow_profile_comments THEN 'everybody' ELSE 'nobody' END"
    )
    op.alter_column(
        "user",
        "profile_comment_visibility",
        nullable=False,
        server_default="everybody",
    )
    op.drop_column("user", "allow_profile_comments")


def downgrade():
    op.add_column(
        "user",
        sa.Column("allow_profile_comments", sa.Boolean(), nullable=True),
    )
    op.execute(
        'UPDATE "user" SET allow_profile_comments = '
        "CASE WHEN profile_comment_visibility = 'nobody' THEN FALSE ELSE TRUE END"
    )
    op.alter_column(
        "user",
        "allow_profile_comments",
        nullable=False,
        server_default=sa.true(),
    )
    op.drop_column("user", "profile_comment_visibility")
