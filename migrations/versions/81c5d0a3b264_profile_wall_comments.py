"""Move comments to profile walls

Revision ID: 81c5d0a3b264
Revises: 5b7a32dc91f0
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa


revision = "81c5d0a3b264"
down_revision = "5b7a32dc91f0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("profile_comment", sa.Column("profile_id", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE profile_comment AS comment "
        "SET profile_id = profile_post.author_id "
        "FROM profile_post WHERE profile_post.id = comment.post_id"
    )
    op.create_foreign_key(
        "fk_profile_comment_profile_id_user",
        "profile_comment",
        "user",
        ["profile_id"],
        ["id"],
    )
    op.alter_column("profile_comment", "profile_id", nullable=False)
    op.alter_column("profile_comment", "post_id", nullable=True)
    op.create_index("ix_profile_comment_profile_id", "profile_comment", ["profile_id"])


def downgrade():
    op.execute("DELETE FROM profile_comment WHERE post_id IS NULL")
    op.drop_index("ix_profile_comment_profile_id", table_name="profile_comment")
    op.drop_constraint("fk_profile_comment_profile_id_user", "profile_comment", type_="foreignkey")
    op.drop_column("profile_comment", "profile_id")
    op.alter_column("profile_comment", "post_id", nullable=False)
