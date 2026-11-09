from datetime import datetime, timezone

from extensions import db


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(32), unique=True, nullable=False, index=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    # Public keys are safe to store on the server. Private keys stay with users.
    public_key = db.Column(db.LargeBinary(32), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    sent_messages = db.relationship(
        "Message",
        foreign_keys="Message.sender_id",
        back_populates="sender",
        lazy=True,
    )
    received_messages = db.relationship(
        "Message",
        foreign_keys="Message.recipient_id",
        back_populates="recipient",
        lazy=True,
    )
    sent_friend_requests = db.relationship(
        "FriendRequest", foreign_keys="FriendRequest.requester_id", back_populates="requester"
    )
    received_friend_requests = db.relationship(
        "FriendRequest", foreign_keys="FriendRequest.addressee_id", back_populates="addressee"
    )


class FriendRequest(db.Model):
    __table_args__ = (
        db.UniqueConstraint("requester_id", "addressee_id", name="uq_friend_request_pair"),
        db.CheckConstraint("requester_id != addressee_id", name="ck_friend_request_not_self"),
    )

    id = db.Column(db.Integer, primary_key=True)
    requester_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    addressee_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    status = db.Column(db.String(16), nullable=False, default="pending")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    requester = db.relationship("User", foreign_keys=[requester_id], back_populates="sent_friend_requests")
    addressee = db.relationship("User", foreign_keys=[addressee_id], back_populates="received_friend_requests")


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    recipient_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    # Store the libsodium encrypted payload, including its nonce; never plaintext.
    encrypted_payload = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    sender = db.relationship(
        "User", foreign_keys=[sender_id], back_populates="sent_messages"
    )
    recipient = db.relationship(
        "User", foreign_keys=[recipient_id], back_populates="received_messages"
    )
