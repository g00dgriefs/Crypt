import { useEffect, useState } from "react";
import {
  createOrUnlockDeviceKeys,
  decryptText,
  decryptImage,
  encodePublicKey,
  encryptText,
  encryptImage,
  isEncryptedImage,
  imageToDataUrl,
  rewrapDeviceKeyBackup,
} from "./crypto.js";
import friendRequestIcon from "../assets/skull-friend-request.svg";
import messagesNavIcon from "../assets/bat-speech-bubble.svg";
import friendsNavIcon from "../assets/skull-friends.svg";
import settingsNavIcon from "../assets/saw-blade.svg";

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
      if (isEncryptedImage(row.encrypted_payload)) {
        const image = await decryptImage(
          row.encrypted_payload,
          sender.public_key,
          keypair.privateKey,
          row.sender_id === user.id
        );

        return {
          ...row,
          type: "image",
          imageUrl: imageToDataUrl(image.mimeType, image.imageBytes),
          content: "",
        };
      }

      return {
        ...row,
        type: "text",
        content: await decryptText(
          row.encrypted_payload,
          sender.public_key,
          keypair.privateKey,
          row.sender_id === user.id
        ),
      };
    } catch {
      return {
        ...row,
        content: "Unable to decrypt this message on this device",
      };
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
  const [theme, setTheme] = useState(() => localStorage.getItem("crypt-theme") === "light" ? "light" : "dark");
  const [profileFriendMessage, setProfileFriendMessage] = useState("");
  const [profileFriendBusy, setProfileFriendBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem("crypt-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const updatePage = () => {
      const requestedPage = currentPage();
      let nextPage = requestedPage;
      if (authChecked && user && requestedPage === "home") nextPage = "messages";
      if (authChecked && !user && !["home", "login", "register"].includes(requestedPage)) nextPage = "home";
      if (nextPage !== requestedPage) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/${nextPage}`);
      }
      setPage(nextPage);
    };
    window.addEventListener("hashchange", updatePage);
    updatePage();
    return () => window.removeEventListener("hashchange", updatePage);
  }, [user, authChecked]);

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

  async function addProfileFriend() {
    if (!profileUser || !user || profileFriendBusy) return;
    setProfileFriendBusy(true);
    setProfileFriendMessage("");
    try {
      await readJson(await fetch("/api/friend-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: `${profileUser.username}/${String(profileUser.identifier).padStart(4, "0")}` }),
      }));
      setFriendRequests(await readJson(await fetch("/api/friend-requests")));
      setProfileFriendMessage("Friend request sent.");
    } catch (error) {
      setProfileFriendMessage(error.message);
    } finally {
      setProfileFriendBusy(false);
    }
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

  const profileCommentVisibility = profileUser?.profile_comment_visibility || "everybody";
  const canViewProfileComments = Boolean(user && profileUser && (
    profileUser.id === user.id ||
    profileCommentVisibility === "everybody" ||
    (profileCommentVisibility === "friends" && friends.some((friend) => friend.id === profileUser.id))
  ));
  const showProfileComments = profileCommentsOpen && canViewProfileComments;

  if (!authChecked) return <div className="app"><main><p>Loading...</p></main></div>;

  return <div className="app">
    {user && <header className="app-header">
      <div className="app-brand"><h1>Crypt</h1></div>
      <nav className="icon-nav" aria-label="Main navigation">
        <a href="#/messages" aria-label="Messages" title="Messages"><img src={messagesNavIcon} alt="" /></a>
        <a href="#/friends" aria-label="Friends" title="Friends"><img src={friendsNavIcon} alt="" /></a>
        <a href="#/settings" aria-label="Settings" title="Settings"><img src={settingsNavIcon} alt="" /></a>
      </nav>
      <div className="account-nav">
        {!user && <><a href="#/login">Login</a><a href="#/register">Register</a></>}
        {user && <button className="header-profile-button" type="button" aria-label="View profile" title="View profile" onClick={() => { setProfileUser(user); setProfileFriendMessage(""); setProfileCommentsOpen(false); setProfileOpen(true); }}>
          <Avatar profilePicture={user.profile_picture} className="header-profile-avatar" />
        </button>}
      </div>
    </header>}

    <main>
      {page === "home" && <div className="home-page"><Home /></div>}
      {page === "messages" && (
        !user
          ? <section><h2>Log in to view messages</h2><a href="#/login">Login</a></section>
          : !keypair
            ? <UnlockKey onUnlock={unlockKey} error={keyError} />
            : <Messages
                user={user}
                onOpenProfile={(person) => { setProfileUser(person); setProfileFriendMessage(""); setProfileCommentsOpen(false); setProfileOpen(true); }}
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
      {page === "friends" && <FriendsPage
        user={user}
        friends={friends}
        setFriends={setFriends}
        friendRequests={friendRequests}
        setFriendRequests={setFriendRequests}
        onViewProfile={(person) => { setProfileUser(person); setProfileFriendMessage(""); setProfileCommentsOpen(false); setProfileOpen(true); }}
      />}
      {page === "settings" && <SettingsPage
        user={user}
        theme={theme}
        onThemeChange={setTheme}
        onLogout={logout}
        onAccountChange={(details) => setUser((current) => ({ ...current, ...details }))}
        onProfileCommentsChange={async (visibility) => {
          const result = await readJson(await fetch("/api/profile/comment-settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile_comment_visibility: visibility }),
          }));
          setUser(result.user);
        }}
        onEditProfile={() => {
          if (!user) { window.location.hash = "/login"; return; }
          setProfileUser(user);
          setProfileFriendMessage("");
          setProfileName(user.display_name || "Crypt User");
          setProfileUsername(user.username);
          setProfileBio(user.bio || "");
          setProfilePicture(user.profile_picture || null);
          setProfileError("");
          setProfileEditing(true);
          setProfileOpen(true);
        }}
      />}
      {!['home', 'messages', 'friends', 'login', 'register', 'settings'].includes(page) && (
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
      <section className={`profile-dialog ${showProfileComments ? "profile-dialog-comments" : ""}`} role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <button className="profile-close" type="button" aria-label="Close profile" onClick={() => { setProfileOpen(false); setProfileEditing(false); }}>{"\u00d7"}</button>
        {showProfileComments && <div className="profile-comments-side">
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
        {canViewProfileComments && <button
          className={`profile-comments-arrow ${profileCommentsOpen ? "is-open" : ""}`}
          type="button"
          aria-label={profileCommentsOpen ? "Close profile comments" : "Open profile comments"}
          aria-expanded={profileCommentsOpen}
          onClick={() => profileCommentsOpen ? setProfileCommentsOpen(false) : openProfileComments()}
        >{"\u2190"}</button>}
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
          <div className="profile-avatar-wrap">
            <div className="profile-picture" style={profileUser.profile_picture ? { backgroundImage: `url(${profileUser.profile_picture})` } : undefined} />
            {user && profileUser.id !== user.id &&
              !friends.some((friend) => friend.id === profileUser.id) &&
              !friendRequests.outgoing.some((request) => request.user.id === profileUser.id) &&
              !friendRequests.incoming.some((request) => request.user.id === profileUser.id) &&
              <button className="profile-friend-request-icon" type="button" disabled={profileFriendBusy} aria-label="Send friend request" title="Send friend request" onClick={addProfileFriend}>
                <img src={friendRequestIcon} alt="" />
              </button>}
          </div>
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
          <p className="profile-handle">{profileUser.username}/{String(profileUser.identifier).padStart(4, "0")}</p>
          {profileUser.bio && <p className="profile-bio">{profileUser.bio}</p>}
          {user && profileUser.id !== user.id && <div className="profile-friend-actions">
            {profileFriendMessage && <p role="status">{profileFriendMessage}</p>}
          </div>}
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
    {(profile.profile_comment_visibility !== "nobody" || isOwner) ? <form className="profile-comment-form" onSubmit={submitComment}>
      <input value={commentContent} onChange={(event) => setCommentContent(event.target.value)} maxLength={1000} placeholder={`Comment on ${profile.display_name || "Crypt User"}'s page...`} aria-label="Comment on this profile" />
      <button type="submit" disabled={submitting || !commentContent.trim()}>{submitting ? "Sending..." : "Comment"}</button>
    </form> : <p>Profile comments are turned off.</p>}
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

function SettingsPage({ user, theme, onThemeChange, onLogout, onEditProfile, onProfileCommentsChange, onAccountChange }) {
  const [category, setCategory] = useState("");
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyError, setPrivacyError] = useState("");
  const categories = ["Profile", "Account", "Privacy", "Voice and Video", "Appearance", "Accessibility"];

  return <section className="page settings-page">
    {category ? <>
      <button type="button" onClick={() => setCategory("")}>Back to settings</button>
      <h2>{category}</h2>
      {category === "Profile" && <button type="button" onClick={onEditProfile}>{user ? "Edit profile" : "Log in to edit profile"}</button>}
      {category === "Account" && (user
        ? <AccountSettings user={user} onLogout={onLogout} onAccountChange={onAccountChange} />
        : <div><h3>Account settings</h3><a href="#/login">Log in</a></div>)}
      {category === "Appearance" && <div>
        <h3>Theme</h3>
        <button type="button" aria-pressed={theme === "dark"} onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}>
          Switch to {theme === "dark" ? "light" : "dark"} mode
        </button>
      </div>}
      {category === "Accessibility" && <p>Coming Soon</p>}
      {category === "Voice and Video" && <p>Coming Soon</p>}
      {category === "Privacy" && <div>
        <label htmlFor="profile-comment-visibility">Profile Comments</label>
        <select
          id="profile-comment-visibility"
          value={user?.profile_comment_visibility || "everybody"}
          disabled={!user || privacySaving}
          onChange={async (event) => {
            setPrivacySaving(true);
            setPrivacyError("");
            try {
              await onProfileCommentsChange(event.target.value);
            } catch (error) {
              setPrivacyError(error.message);
            } finally {
              setPrivacySaving(false);
            }
          }}
        >
          <option value="everybody">Everybody</option>
          <option value="friends">Friends</option>
          <option value="nobody">Nobody</option>
        </select>
        {privacyError && <p role="alert">{privacyError}</p>}
      </div>}
    </> : <>
      <h2>Settings</h2>
      <div className="settings-categories">
        {categories.map((item) => (
          <button type="button" className="settings-category" key={item} onClick={() => setCategory(item)} style={{ width: "100%", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}>
            <h3>{item}</h3>
          </button>
        ))}
      </div>
    </>}
  </section>;
}

function AccountSettings({ user, onLogout, onAccountChange }) {
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState("");
  const [value, setValue] = useState("");
  const [fieldPassword, setFieldPassword] = useState("");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNext, setPasswordNext] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/account").then(readJson).then((account) => {
      if (active) setEmail(account.email);
    }).catch((failure) => {
      if (active) setError(failure.message);
    });
    return () => { active = false; };
  }, []);

  function startEditing(field, currentValue) {
    setEditing(field);
    setValue(currentValue);
    setFieldPassword("");
    setError("");
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const updated = await readJson(await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: editing, value, current_password: fieldPassword }),
      }));
      setEmail(updated.email);
      onAccountChange(updated);
      setEditing("");
      setFieldPassword("");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    if (passwordNext !== passwordConfirm) {
      setError("New passwords do not match.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const rewrapped = await rewrapDeviceKeyBackup(user.id, passwordCurrent, passwordNext);
      await readJson(await fetch("/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: passwordCurrent,
          new_password: passwordNext,
          backup: rewrapped?.backup ?? null,
        }),
      }));
      if (rewrapped) localStorage.setItem(rewrapped.storageKey, JSON.stringify(rewrapped.backup));
      setChangingPassword(false);
      setPasswordCurrent("");
      setPasswordNext("");
      setPasswordConfirm("");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  const accountFields = [
    { key: "username", label: "Username", current: user.username, action: "Change username" },
    { key: "email", label: "Email", current: email || "Loading...", action: "Change email" },
  ];

  return <div>
    <h3>Account settings</h3>
    {accountFields.map((field) => <div className="account-setting" key={field.key}>
      <label htmlFor={`account-${field.key}`}>{field.label}</label>
      {editing === field.key ? <form className="account-setting-row" onSubmit={save}>
        <input
          id={`account-${field.key}`}
          type={field.key === "email" ? "email" : "text"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={field.key === "email" ? 255 : 32}
          autoComplete={field.key === "email" ? "email" : "username"}
          required
        />
        <input
          type="password"
          value={fieldPassword}
          onChange={(event) => setFieldPassword(event.target.value)}
          placeholder="Current password"
          aria-label="Current password"
          autoComplete="current-password"
          required
        />
        <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        <button type="button" disabled={saving} onClick={() => { setEditing(""); setFieldPassword(""); setError(""); }}>Cancel</button>
      </form> : <div className="account-setting-row">
        <input id={`account-${field.key}`} className="account-setting-value" type="text" value={field.current} readOnly />
        <button type="button" disabled={field.key === "email" && !email} onClick={() => startEditing(field.key, field.current === "Loading..." ? "" : field.current)}>Change</button>
      </div>}
    </div>)}
    <div className="account-setting">
      <label htmlFor="account-password">Password</label>
      {changingPassword ? <form className="account-password-form" onSubmit={changePassword}>
        <label>Current password<input type="password" value={passwordCurrent} onChange={(event) => setPasswordCurrent(event.target.value)} autoComplete="current-password" required /></label>
        <label>New password<input type="password" value={passwordNext} onChange={(event) => setPasswordNext(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
        <label>Confirm new password<input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
        <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        <button type="button" disabled={saving} onClick={() => { setChangingPassword(false); setPasswordCurrent(""); setPasswordNext(""); setPasswordConfirm(""); setError(""); }}>Cancel</button>
      </form> : <div className="account-setting-row">
        <button type="button" onClick={() => { setChangingPassword(true); setError(""); }}>Change</button>
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={onLogout}>Log out</button>
  </div>;
}

function FriendsPage({ user, friends, setFriends, friendRequests, setFriendRequests, onViewProfile }) {
  const [handle, setHandle] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [requestBusyId, setRequestBusyId] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    setFriendsLoading(true);
    setFriendsError("");
    Promise.all([
      fetch("/api/friends").then(readJson),
      fetch("/api/friend-requests").then(readJson),
    ]).then(([loadedFriends, requests]) => {
      if (active) {
        setFriends(loadedFriends);
        setFriendRequests(requests);
      }
    }).catch((failure) => {
      if (active) setFriendsError(failure.message);
    }).finally(() => {
      if (active) setFriendsLoading(false);
    });
    return () => { active = false; };
  }, [user?.id, setFriends]);

  async function refreshRelations() {
    const [loadedFriends, requests] = await Promise.all([
      fetch("/api/friends").then(readJson),
      fetch("/api/friend-requests").then(readJson),
    ]);
    setFriends(loadedFriends);
    setFriendRequests(requests);
  }

  async function respondToRequest(requestId, action) {
    setRequestBusyId(requestId);
    setRequestError("");
    try {
      await readJson(await fetch(`/api/friend-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }));
      await refreshRelations();
    } catch (failure) {
      setRequestError(failure.message);
    } finally {
      setRequestBusyId(null);
    }
  }

  async function cancelRequest(requestId) {
    setRequestBusyId(requestId);
    setRequestError("");
    try {
      await readJson(await fetch(`/api/friend-requests/${requestId}`, { method: "DELETE" }));
      await refreshRelations();
    } catch (failure) {
      setRequestError(failure.message);
    } finally {
      setRequestBusyId(null);
    }
  }

  async function search(event) {
    event.preventDefault();
    setSearching(true);
    setResult(null);
    setError("");
    try {
      const person = await readJson(await fetch(`/api/users/search?handle=${encodeURIComponent(handle.trim())}`));
      setResult(person);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSearching(false);
    }
  }

  return <section className="page friends-page">
    <h2>Friends</h2>
    <form className="friends-search-form" onSubmit={search}>
      <input
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
        placeholder="username/1234"
        aria-label="Search by username and identifier"
        maxLength={40}
        required
      />
      <button type="submit" disabled={searching}>{searching ? "Searching..." : "Search"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <div className="friends-search-result">
      <span>{result.display_name || "Crypt User"} · {result.username}/{String(result.identifier).padStart(4, "0")}</span>
      <button type="button" onClick={() => onViewProfile(result)}>View</button>
    </div>}
    {!user && <p role="alert">Log in to search for users.</p>}
    {user && friendRequests.incoming.length > 0 && <div className="friends-request-list">
      <h3>Incoming Requests</h3>
      {friendRequests.incoming.map((item) => <div className="friends-request-row" key={item.id}>
        <span>{item.user.display_name || "Crypt User"}<small>{item.user.username}/{String(item.user.identifier).padStart(4, "0")}</small></span>
        <button type="button" disabled={requestBusyId === item.id} onClick={() => respondToRequest(item.id, "accept")}>Accept</button>
        <button type="button" disabled={requestBusyId === item.id} onClick={() => respondToRequest(item.id, "decline")}>Decline</button>
      </div>)}
    </div>}
    {user && <div className="friends-directory">
      <h3>Friends</h3>
      {friendsError && <p role="alert">{friendsError}</p>}
      {friendsLoading ? <p>Loading friends...</p> : friends.length === 0 ? <p>No friends yet.</p> : friends.map((friend) => <div className="friends-directory-row" key={friend.id}>
        <Avatar profilePicture={friend.profile_picture} />
        <span>{friend.display_name || "Crypt User"}<small>{friend.username}/{String(friend.identifier).padStart(4, "0")}</small></span>
        <button type="button" onClick={() => onViewProfile(friend)}>View</button>
      </div>)}
    </div>}
    {user && friendRequests.outgoing.length > 0 && <div className="friends-request-list friends-pending-list">
      <h3>Pending Requests</h3>
      {friendRequests.outgoing.map((item) => <div className="friends-request-row" key={item.id}>
        <span>{item.user.display_name || "Crypt User"}<small>{item.user.username}/{String(item.user.identifier).padStart(4, "0")}</small></span>
        <button type="button" disabled={requestBusyId === item.id} onClick={() => cancelRequest(item.id)}>Cancel</button>
      </div>)}
    </div>}
    {requestError && <p role="alert">{requestError}</p>}
  </section>;
}

function Home() {
  return <>
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

  async function sendImage(event) {
   const file = event.target.files[0];
    
    if (!file) return;
    
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];

    if (!allowedTypes.includes(file.type)) {
      setsendError("Please Select a JPEG,PNG,WEBP OR GIF");
      event.target.value = "";
      return;
    }
   
    if (file.size > 450 * 1024) {
      setSendError("Image must be smaller than 450 KB.");
      event.target.value = "";
      return;
    }

    if (!friend || !keypair || sending) {
      event.target.value = "";
      return;
    }
  
    if (!friend.public_key) {
      setSendError("This friend has not set up an encryption key yet.");
      event.target.value = "";
      return;
    }
  
    setSending(true);
    setSendError("");
  
    try {
      const imageBytes = new Uint8Array(await file.arrayBuffer());
      const imageUrl = imageToDataUrl(file.type, imageBytes);
  
      const encryptedPayload = await encryptImage(
        file,
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
  
      setMessages((current) => [
        ...current,
        {
          ...sent,
          type: "image",
          imageUrl,
          content: "",
        },
      ]);
    } catch (error) {
      setSendError(error.message || "Image could not be sent");
    } finally {
      setSending(false);
      event.target.value = "";
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

              {item.type === "image" ? (
                <img
                className="message-image"
                src={item.imageUrl}
                alt="image attachment"
                />
              ) : (

              <div className="messaging-bubble">{item.content}</div>
              )}
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

          <input 
           type="file"
           accept="image/jpeg,image/png,image/webp,image/gif"
           onChange={sendImage}
           disabled={sending || !friend || !friend.public_key}

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

  return <section className={`page ${registering ? "register-page" : "login-page"}`}>
     <div className="login-box">
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
   </div>
  </section>;
}
