import { useEffect, useState } from "react";
import {
  createOrUnlockDeviceKeys,
  decryptText,
  encodePublicKey,
  encryptText,
} from "./crypto.js";

function currentPage() {
  return window.location.hash.replace(/^#\/?/, "") || "home";
}

async function readJson(response) {
  const responseText = await response.text();
  let body = {};
  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function Avatar({ profilePicture, className = "friend-avatar" }) {
  return profilePicture
    ? <img className={className} src={profilePicture} alt="" aria-hidden="true" />
    : <span className={className} aria-hidden="true" />;
}

async function decryptRows(rows, user, contacts, keypair) {
  const currentUser = {
    ...user,
    public_key: user.public_key || encodePublicKey(keypair.publicKey),
  };
  return Promise.all(rows.map(async (row) => {
    const sender = row.sender_id === user.id
      ? currentUser
      : contacts.find((contact) => contact.id === row.sender_id);
    if (!sender?.public_key) {
      return { ...row, content: "Sender encryption key unavailable" };
    }
    try {
      return {
        ...row,
        content: await decryptText(
          row.encrypted_payload,
          sender.public_key,
          keypair.privateKey,
          row.sender_id === user.id
        ),
      };
    } catch {
      return { ...row, content: "Unable to decrypt this message on this device" };
    }
  }));
}

export default function App() {
  const [page, setPage] = useState(currentPage);
  const [user, setUser] = useState(null);
  const [keypair, setKeypair] = useState(null);
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState({ incoming: [], outgoing: [] });
  const [messages, setMessages] = useState([]);
  const [authChecked, setAuthChecked] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUser, setProfileUser] = useState(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profilePicture, setProfilePicture] = useState(null);
  const [profileError, setProfileError] = useState("");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [profileCommentsOpen, setProfileCommentsOpen] = useState(false);
  const [profileComments, setProfileComments] = useState([]);
  const [profileCommentsLoading, setProfileCommentsLoading] = useState(false);
  const [profileCommentsError, setProfileCommentsError] = useState("");

  useEffect(() => {
    const updatePage = () => setPage(currentPage());
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  useEffect(() => {
    if (!profileOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") { setProfileOpen(false); setProfileEditing(false); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [profileOpen]);

  useEffect(() => {
    let active = true;
    fetch("/api/me")
      .then(readJson)
      .then(({ user: currentUser }) => {
        if (active) {
          setUser(currentUser);
          if (!window.location.hash || currentPage() === "home") {
            setPage("messages");
            window.location.hash = "/messages";
          }
        }
      })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setAuthChecked(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user || !keypair) {
      setFriends([]);
      setFriendRequests({ incoming: [], outgoing: [] });
      setMessages([]);
      return;
    }
    let active = true;
    setLoadError("");
    const refresh = async () => {
      try {
        const [contacts, rows, requests] = await Promise.all([
          fetch("/api/friends").then(readJson),
          fetch("/api/messages").then(readJson),
          fetch("/api/friend-requests").then(readJson),
        ]);
        const decrypted = await decryptRows(rows, user, contacts, keypair);
        if (active) {
          setFriends(contacts);
          setFriendRequests(requests);
          setMessages(decrypted);
          setLoadError("");
        }
      } catch (error) {
        if (active) setLoadError(error.message);
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 4000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user, keypair]);

  async function finishSignIn(authenticatedUser, password, isNewAccount = false) {
    setUser(authenticatedUser);
    setPage("messages");
    window.location.hash = "/messages";
    setKeyError("");
    try {
      const localKeys = await createOrUnlockDeviceKeys(authenticatedUser, password);
      setKeypair(localKeys);
    } catch (error) {
      setKeypair(null);
      setKeyError(error.message);
    }
    if (isNewAccount) setOnboardingOpen(true);
  }

  async function saveOnboardingProfile(displayName, picture) {
    const result = await readJson(await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        username: user.username,
        bio: user.bio || "",
        profile_picture: picture,
      }),
    }));
    setUser(result.user);
    setOnboardingOpen(false);
  }

  async function openProfileComments() {
    if (!profileUser) return;
    setProfileCommentsOpen(true);
    setProfileCommentsLoading(true);
    setProfileCommentsError("");
    try {
      setProfileComments(await readJson(await fetch(`/api/profiles/${profileUser.id}/comments`)));
    } catch (error) {
      setProfileCommentsError(error.message);
    } finally {
      setProfileCommentsLoading(false);
    }
  }

  async function createProfileComment(content) {
    await readJson(await fetch(`/api/profiles/${profileUser.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }));
    setProfileComments(await readJson(await fetch(`/api/profiles/${profileUser.id}/comments`)));
  }

  async function deleteProfileComment(commentId) {
    await readJson(await fetch(`/api/profiles/${profileUser.id}/comments/${commentId}`, {
      method: "DELETE",
    }));
    setProfileComments(await readJson(await fetch(`/api/profiles/${profileUser.id}/comments`)));
  }

  async function unlockKey(password) {
    setKeyError("");
    try {
      const localKeys = await createOrUnlockDeviceKeys(user, password);
      setKeypair(localKeys);
    } catch (error) {
      setKeyError(error.message);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    setUser(null);
    setKeypair(null);
    setFriends([]);
    setFriendRequests({ incoming: [], outgoing: [] });
    setMessages([]);
    setKeyError("");
    window.location.hash = "/home";
  }

  async function saveProfile(event) {
    event.preventDefault();
    setProfileError("");
    try {
      const result = await readJson(await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: profileName, username: profileUsername, bio: profileBio, profile_picture: profilePicture }),
      }));
      setUser(result.user);
      setProfileUser(result.user);
      setProfileEditing(false);
    } catch (error) {
      setProfileError(error.message);
    }
  }

  if (!authChecked) return <div className="app"><main><p>Loading...</p></main></div>;

  return <div className="app">
    <header>
      <h1>Crypt</h1>
      <nav aria-label="Main navigation">
        <a href="#/home">Home</a>
        <a href="#/messages">Messages</a>
        <a href="#/settings">Settings</a>
        {!user && <><a href="#/login">Login</a><a href="#/register">Register</a></>}
        {user && <>
          <button type="button" onClick={() => { setProfileUser(user); setProfileCommentsOpen(false); setProfileOpen(true); }}>Profile</button>
          <button type="button" onClick={logout}>Logout</button>
        </>}
      </nav>
    </header>

    <main>
      {page === "home" && <div className="home-page"><Home /></div>}
      {page === "messages" && (
        !user
          ? <section><h2>Log in to view messages</h2><a href="#/login">Login</a></section>
          : !keypair
            ? <UnlockKey onUnlock={unlockKey} error={keyError} />
            : <Messages
                user={user}
                onOpenProfile={(person) => { setProfileUser(person); setProfileCommentsOpen(false); setProfileOpen(true); }}
                friends={friends}
                setFriends={setFriends}
                friendRequests={friendRequests}
                setFriendRequests={setFriendRequests}
                messages={messages}
                setMessages={setMessages}
                keypair={keypair}
                loadError={loadError}
              />
      )}
      {page === "login" && <AccountPage mode="login" onAuthenticated={finishSignIn} />}
      {page === "register" && <AccountPage mode="register" onAuthenticated={finishSignIn} />}
      {page === "settings" && <SettingsPage />}
      {!['home', 'messages', 'login', 'register', 'settings'].includes(page) && (
        <section><h2>Page not found</h2><p>Choose a page from the navigation above.</p></section>
      )}
    </main>
    {onboardingOpen && user && <OnboardingDialog
      onSkip={() => setOnboardingOpen(false)}
      onSave={saveOnboardingProfile}
    />}
    {profileOpen && profileUser && <div className="profile-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) { setProfileOpen(false); setProfileEditing(false); }
    }}>
      <section className={`profile-dialog ${profileCommentsOpen ? "profile-dialog-comments" : ""}`} role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <button className="profile-close" type="button" aria-label="Close profile" onClick={() => { setProfileOpen(false); setProfileEditing(false); }}>{"\u00d7"}</button>
        {profileCommentsOpen && <div className="profile-comments-side">
          <ProfileCommentsView
            profile={profileUser}
            isOwner={profileUser.id === user?.id}
            comments={profileComments}
            loading={profileCommentsLoading}
            error={profileCommentsError}
            onCreateComment={createProfileComment}
            onDeleteComment={deleteProfileComment}
          />
        </div>}
        <div className="profile-summary">
        <button
          className={`profile-comments-arrow ${profileCommentsOpen ? "is-open" : ""}`}
          type="button"
          aria-label={profileCommentsOpen ? "Close profile comments" : "Open profile comments"}
          aria-expanded={profileCommentsOpen}
          onClick={() => profileCommentsOpen ? setProfileCommentsOpen(false) : openProfileComments()}
        >{"\u2190"}</button>
        {profileEditing ? <form className="profile-edit-form" onSubmit={saveProfile}>
          <div className="profile-picture" style={profilePicture ? { backgroundImage: `url(${profilePicture})` } : undefined} />
          <label>Profile picture<input type="file" accept="image/*" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 1_400_000) { setProfileError("Choose a PNG, JPEG, WebP, or GIF under 1.4 MB."); return; }
            const reader = new FileReader();
            reader.onload = () => { setProfilePicture(reader.result); setProfileError(""); };
            reader.readAsDataURL(file);
          }} /></label>
          {profilePicture && <button type="button" className="profile-remove-picture" onClick={() => setProfilePicture(null)}>Remove picture</button>}
          <label>Display name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={32} required /></label>
          <label>Username<input value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} maxLength={32} required /></label>
          <p className="profile-handle">Identifier: {String(profileUser.identifier).padStart(4, "0")}</p>
          <label>Bio<textarea value={profileBio} onChange={(event) => setProfileBio(event.target.value)} maxLength={500} rows={3} /></label>
          {profileError && <p role="alert">{profileError}</p>}
          <div className="profile-edit-actions">
            <button type="button" onClick={() => { setProfileEditing(false); setProfileError(""); }}>Cancel</button>
            <button type="submit">Save</button>
          </div>
        </form> : <>
          <div className="profile-picture" style={profileUser.profile_picture ? { backgroundImage: `url(${profileUser.profile_picture})` } : undefined} />
          <div className="profile-name-row">
            <h2 id="profile-title">{profileUser.display_name || "Crypt User"}</h2>
            {profileUser.id === user?.id && <button type="button" className="profile-settings-button" onClick={() => {
              setProfileName(profileUser.display_name || "Crypt User");
              setProfileUsername(profileUser.username);
              setProfileBio(profileUser.bio || "");
              setProfilePicture(profileUser.profile_picture || null);
              setProfileError("");
              setProfileEditing(true);
            }}>Settings</button>}
          </div>
          <p className="profile-handle">@{profileUser.username}/{String(profileUser.identifier).padStart(4, "0")}</p>
          {profileUser.bio && <p className="profile-bio">{profileUser.bio}</p>}
        </>}
        </div>
      </section>
    </div>}
  </div>;
}

function ProfileCommentsView({ profile, isOwner, comments, loading, error, onCreateComment, onDeleteComment }) {
  const [commentContent, setCommentContent] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  async function submitComment(event) {
    event.preventDefault();
    if (!commentContent.trim() || submitting) return;
    setSubmitting(true);
    setActionError("");
    try {
      await onCreateComment(commentContent.trim());
      setCommentContent("");
    } catch (failure) {
      setActionError(failure.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteComment(commentId) {
    setDeletingId(commentId);
    setActionError("");
    try {
      await onDeleteComment(commentId);
    } catch (failure) {
      setActionError(failure.message);
    } finally {
      setDeletingId(null);
    }
  }

  return <div className="profile-comments-view">
    <h2>Comments</h2>
    {(error || actionError) && <p className="profile-comment-error" role="alert">{error || actionError}</p>}
    {loading ? <p>Loading comments...</p> : comments.length === 0 ? <p className="profile-no-comments">No comments yet.</p> : <div className="profile-comment-list">
      {comments.map((comment) => <div className="profile-comment" key={comment.id}>
        <strong>{comment.author.id === profile.id && <span className="profile-owner-star" aria-label="Profile owner">★ </span>}{comment.author.display_name || "Crypt User"}</strong>
        <span>{comment.content}</span>
        <time>{new Date(comment.created_at).toLocaleString()}</time>
        {isOwner && <button className="profile-comment-delete" type="button" disabled={deletingId === comment.id} aria-label={`Delete comment by ${comment.author.display_name || "Crypt User"}`} onClick={() => deleteComment(comment.id)}>{deletingId === comment.id ? "Deleting..." : "Delete"}</button>}
      </div>)}
    </div>}
    <form className="profile-comment-form" onSubmit={submitComment}>
      <input value={commentContent} onChange={(event) => setCommentContent(event.target.value)} maxLength={1000} placeholder={`Comment on ${profile.display_name || "Crypt User"}'s page...`} aria-label="Comment on this profile" />
      <button type="submit" disabled={submitting || !commentContent.trim()}>{submitting ? "Sending..." : "Comment"}</button>
    </form>
  </div>;
}

function OnboardingDialog({ onSkip, onSave }) {
  const [displayName, setDisplayName] = useState("");
  const [picture, setPicture] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(displayName.trim(), picture);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  function choosePicture(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 1_400_000) {
      setError("Choose a PNG, JPEG, WebP, or GIF under 1.4 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setPicture(reader.result); setError(""); };
    reader.readAsDataURL(file);
  }

  return <div className="profile-overlay onboarding-overlay">
    <section className="profile-dialog onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <h2 id="onboarding-title">Almost there!</h2>
      <p>Add a display name and profile picture to personalize your account</p>
      <form className="onboarding-form" onSubmit={submit}>
        <div className="profile-picture" style={picture ? { backgroundImage: `url(${picture})` } : undefined} aria-label="Profile picture preview" />
        <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Crypt User" maxLength={32} required /></label>
        <label>Profile picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={choosePicture} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="onboarding-actions">
          <button type="button" className="onboarding-skip" onClick={onSkip}>Skip</button>
          <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
        </div>
      </form>
    </section>
  </div>;
}

function SettingsPage() {
  const categories = ["Profile", "Account", "Privacy", "Voice and Video", "Appearance", "Accessibility"];

  return <section className="page settings-page">
    <h2>Settings</h2>
    <div className="settings-categories">
      {categories.map((category) => (
        <div className="settings-category" key={category}>
          <h3>{category}</h3>
        </div>
      ))}
    </div>
  </section>;
}

function Home() {
  return <>
    <h1>CRYPT</h1>
    <p>Secure connections are our priority</p>
    <div className="home-buttons">
      <a href="#/login">Login</a>
      <a href="#/register">Register</a>
    </div>
  </>;
}

function UnlockKey({ onUnlock, error }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    await onUnlock(password);
    setPassword("");
    setBusy(false);
  }

  return <section className="page">
    <h2>Unlock this device</h2>
    <p>Your password unlocks the encrypted private key stored in this browser. It is not sent for this step.</p>
    <form onSubmit={submit}>
      <label>
        Account password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Unlocking..." : "Unlock"}</button>
    </form>
  </section>;
}

function Messages({ user, onOpenProfile, friends, setFriends, friendRequests, setFriendRequests, messages, setMessages, keypair, loadError }) {
  const [friendId, setFriendId] = useState(null);
  const friend = friends.find((contact) => contact.id === friendId) || null;
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [addingFriend, setAddingFriend] = useState(false);
  const [friendUsername, setFriendUsername] = useState("");
  const [friendError, setFriendError] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);

  async function addFriend(event) {
    event.preventDefault();
    setFriendBusy(true);
    setFriendError("");
    try {
      await readJson(await fetch("/api/friend-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: friendUsername }),
      }));
      const requests = await readJson(await fetch("/api/friend-requests"));
      setFriendRequests(requests);
      setFriendUsername("");
      setAddingFriend(false);
    } catch (error) {
      setFriendError(error.message);
    } finally {
      setFriendBusy(false);
    }
  }

  async function respondToRequest(requestId, action) {
    setFriendError("");
    try {
      await readJson(await fetch(`/api/friend-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }));
      const [requests, contacts] = await Promise.all([
        fetch("/api/friend-requests").then(readJson),
        fetch("/api/friends").then(readJson),
      ]);
      setFriendRequests(requests);
      setFriends(contacts);
    } catch (error) {
      setFriendError(error.message);
    }
  }

  async function cancelFriendRequest(requestId) {
    setFriendError("");
    try {
      await readJson(await fetch(`/api/friend-requests/${requestId}`, { method: "DELETE" }));
      setFriendRequests(await readJson(await fetch("/api/friend-requests")));
    } catch (error) {
      setFriendError(error.message);
    }
  }

  async function send(event) {
    event.preventDefault();
    const content = message.trim();
    if (!content || !friend || !keypair || sending) return;
    if (!friend.public_key) {
      setSendError(`${friend.display_name || "Crypt User"} has not set up an encryption key yet.`);
      return;
    }
    setSending(true);
    setSendError("");
    try {
      const encryptedPayload = await encryptText(
        content,
        friend.public_key,
        keypair.privateKey
      );
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_id: friend.id,
          encrypted_payload: encryptedPayload,
        }),
      });
      const sent = await readJson(response);
      setMessages((current) => [...current, { ...sent, content }]);
      setMessage("");
    } catch (error) {
      setSendError(error.message || "Message could not be sent");
    } finally {
      setSending(false);
    }
  }

  const conversation = messages.filter((item) =>
    item.sender_id === friend?.id || item.recipient_id === friend?.id
  );

  return <div className="messages-page">
    <aside className="friendslist">
      <h3>Friends</h3>
      <button className="add-friend-button" type="button" onClick={() => { setAddingFriend((open) => !open); setFriendError(""); }}>
        {addingFriend ? "Cancel" : "+ Add friend"}
      </button>
      {addingFriend && <form className="add-friend-form" onSubmit={addFriend}>
        <label htmlFor="friend-username">Username and identifier</label>
        <input
          id="friend-username"
          value={friendUsername}
          onChange={(event) => setFriendUsername(event.target.value)}
          placeholder="goku/4011"
          maxLength={40}
          required
        />
        <button type="submit" disabled={friendBusy}>{friendBusy ? "Sending..." : "Send request"}</button>
      </form>}
      {friendRequests.incoming.length > 0 && <div className="friend-requests">
        <h4>Requests</h4>
        {friendRequests.incoming.map((item) => <div className="friend-request" key={item.id}>
          <span>{item.user.display_name || "Crypt User"}</span>
          <div>
            <button type="button" onClick={() => respondToRequest(item.id, "accept")}>Accept</button>
            <button type="button" onClick={() => respondToRequest(item.id, "decline")}>Decline</button>
          </div>
        </div>)}
      </div>}
      {friendError && <p className="friend-error" role="alert">{friendError}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {friends.length === 0 ? <p>No contacts available</p> : friends.map((person) => (
        <div className={`friend-entry ${friend?.id === person.id ? "friend-selected" : ""}`} key={person.id}>
          <button type="button" className="friend-profile-button" aria-label={`View ${person.display_name || "Crypt User"}'s profile`} onClick={() => onOpenProfile(person)}>
            <Avatar profilePicture={person.profile_picture} />
          </button>
          <button type="button" className="friend-select-button" onClick={() => { setFriendId(person.id); setSendError(""); }}>
            {person.display_name || "Crypt User"}{!person.public_key ? " (key not set up)" : ""}
          </button>
        </div>
      ))}
      {friendRequests.outgoing.length > 0 && <div className="friend-requests sent-requests">
        <h4>Sent</h4>
        {friendRequests.outgoing.map((item) => <div className="sent-friend-request" key={item.id}>
          <span>{item.user.display_name || "Crypt User"} · Pending</span>
          <button type="button" onClick={() => cancelFriendRequest(item.id)}>Cancel</button>
        </div>)}
      </div>}
    </aside>
    <section className="message-window">
      {friend ? <>
        <header className="chat-header">
          <div className="chat-person">
            <button
              type="button"
              className="chat-avatar-button"
              aria-label={`View ${friend.display_name || "Crypt User"}'s profile`}
              onClick={() => onOpenProfile(friend)}
            ><Avatar profilePicture={friend.profile_picture} /></button>
            <h3>{friend.display_name || "Crypt User"}</h3>
          </div>
        </header>
        <div className="chat-messages">
          {conversation.map((item) => (
            <div
              key={item.id}
              className={`message-row ${item.sender_id === user.id ? "message-own" : "message-theirs"}`}
            >
              <div className="message-sender">
                {item.sender_id === user.id ? (user.display_name || "Crypt User") : (friend.display_name || "Crypt User")}
              </div>
              <div className="messaging-bubble">{item.content}</div>
            </div>
          ))}
        </div>
        {sendError && <p role="alert">{sendError}</p>}
        <form className="message-form" onSubmit={send}>
          <input
            type="text"
            placeholder="Write a message..."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !friend.public_key}>
            {sending ? "Sending..." : "Send"}
          </button>
        </form>
      </> : <div className="empty-chat"><p>Select a contact to start a conversation.</p></div>}
    </section>
  </div>;
}

function AccountPage({ mode, onAuthenticated }) {
  const registering = mode === "register";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    const body = { email: form.get("email"), password };
    if (registering) body.username = form.get("username");
    try {
      const response = await fetch(`/api/${registering ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJson(response);
      await onAuthenticated(result.user, password, registering);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="page">
    <h2>{registering ? "Register" : "Login"}</h2>
    <form onSubmit={submit}>
      {registering && <label>
        Username
        <input type="text" name="username" autoComplete="username" required maxLength={16} />
      </label>}
      <label>
        Email
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete={registering ? "new-password" : "current-password"}
          required
          minLength={registering ? 8 : undefined}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Please wait..." : registering ? "Register" : "Login"}</button>
    </form>
  </section>;
}
