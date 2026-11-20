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
    with op.batch_alter_table("user") as batch_op:
        batch_op.alter_column(
            "profile_comment_visibility",
            existing_type=sa.String(length=16),
            existing_nullable=True,
            nullable=False,
            server_default="everybody",
        )
        batch_op.drop_column("allow_profile_comments")
    if op.get_bind().dialect.name == "sqlite":
        op.create_index(
            "uq_user_username_identifier",
            "user",
            [sa.text("lower(username)"), "identifier"],
            unique=True,
        )


def downgrade():
    op.add_column(
        "user",
        sa.Column("allow_profile_comments", sa.Boolean(), nullable=True),
    )
    op.execute(
        'UPDATE "user" SET allow_profile_comments = '
        "CASE WHEN profile_comment_visibility = 'nobody' THEN FALSE ELSE TRUE END"
    )
    with op.batch_alter_table("user") as batch_op:
        batch_op.alter_column(
            "allow_profile_comments",
            existing_type=sa.Boolean(),
            existing_nullable=True,
            nullable=False,
            server_default=sa.true(),
        )
        batch_op.drop_column("profile_comment_visibility")
    if op.get_bind().dialect.name == "sqlite":
        op.create_index(
            "uq_user_username_identifier",
            "user",
            [sa.text("lower(username)"), "identifier"],
            unique=True,
        )
