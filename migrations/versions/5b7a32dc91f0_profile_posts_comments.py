"""Add profile posts and comments

Revision ID: 5b7a32dc91f0
Revises: f27b90e6c143
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa


revision = "5b7a32dc91f0"
down_revision = "f27b90e6c143"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "profile_post",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.String(length=2000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["author_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_profile_post_author_id", "profile_post", ["author_id"])
    op.create_index("ix_profile_post_created_at", "profile_post", ["created_at"])
    op.create_table(
        "profile_comment",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.String(length=1000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["author_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["post_id"], ["profile_post.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_profile_comment_post_id", "profile_comment", ["post_id"])
    op.create_index("ix_profile_comment_author_id", "profile_comment", ["author_id"])
    op.create_index("ix_profile_comment_created_at", "profile_comment", ["created_at"])


def downgrade():
    op.drop_index("ix_profile_comment_created_at", table_name="profile_comment")
    op.drop_index("ix_profile_comment_author_id", table_name="profile_comment")
    op.drop_index("ix_profile_comment_post_id", table_name="profile_comment")
    op.drop_table("profile_comment")
    op.drop_index("ix_profile_post_created_at", table_name="profile_post")
    op.drop_index("ix_profile_post_author_id", table_name="profile_post")
    op.drop_table("profile_post")
