/**
 * Database and Auth Bridge for Google Firestore vs. Safe Offline Local LAN Mode.
 * This file handles E2E encryption data storage transparency.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "./firebase";
import { UserProfile, Group, GroupMember, Message, AllowedEmail } from "../types";

// Dynamic check for offline/LAN activation
export function isLocalMode(): boolean {
  return localStorage.getItem("emergency_local_mode") === "true";
}

export function setLocalMode(active: boolean) {
  localStorage.setItem("emergency_local_mode", active ? "true" : "false");
}

// -------------------------------------------------------------
// Local Auth Session Mock (For networks without internet)
// -------------------------------------------------------------
export interface LocalSession {
  uid: string;
  email: string;
  displayName: string;
}

export function getLocalUserSession(): LocalSession | null {
  const data = localStorage.getItem("local_user_session");
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function setLocalUserSession(session: LocalSession | null) {
  if (session) {
    localStorage.setItem("local_user_session", JSON.stringify(session));
  } else {
    localStorage.removeItem("local_user_session");
  }
}

// Check local settings for emergency overrides
export async function getLocalSettings(): Promise<{ allowSelfAuthInEmergency: boolean }> {
  try {
    const res = await fetch("/api/local/settings");
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("Failed to load local offline settings", e);
  }
  return { allowSelfAuthInEmergency: true };
}

export async function setLocalSettings(settings: { allowSelfAuthInEmergency: boolean }): Promise<void> {
  try {
    await fetch("/api/local/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  } catch (e) {
    console.error("Failed to update local offline settings", e);
  }
}

// -------------------------------------------------------------
// Real-time Subscriptions (Abstracted transparently)
// -------------------------------------------------------------

// 1. Subscribe to whitelisted emails
export function subscribeAllowedEmails(callback: (emails: AllowedEmail[]) => void): () => void {
  if (!isLocalMode()) {
    return onSnapshot(
      collection(db, "allowed_emails"),
      (snapshot) => {
        const list: AllowedEmail[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as AllowedEmail);
        });
        callback(list);
      },
      (err) => console.error("Firebase emails list subscription failed", err)
    );
  } else {
    const poll = async () => {
      try {
        const res = await fetch("/api/local/allowed_emails");
        if (res.ok) {
          const list = await res.json();
          callback(list);
        }
      } catch (e) {
        console.warn("Offline whitelist poll exception:", e);
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }
}

// 2. Subscribe to groups
export function subscribeGroups(callback: (groups: Group[]) => void): () => void {
  if (!isLocalMode()) {
    return onSnapshot(
      collection(db, "groups"),
      (snapshot) => {
        const list: Group[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as Group);
        });
        callback(list);
      },
      (err) => console.error("Firebase groups list subscription failed", err)
    );
  } else {
    const poll = async () => {
      try {
        const res = await fetch("/api/local/groups");
        if (res.ok) {
          const list = await res.json();
          callback(list);
        }
      } catch (e) {
        console.warn("Offline groups poll exception:", e);
      }
    };
    poll();
    const interval = setInterval(poll, 3400);
    return () => clearInterval(interval);
  }
}

// 3. Subscribe to overall registered users
export function subscribeUsers(callback: (users: UserProfile[]) => void): () => void {
  if (!isLocalMode()) {
    return onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const list: UserProfile[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as UserProfile);
        });
        callback(list);
      },
      (err) => console.error("Firebase users list subscription failed", err)
    );
  } else {
    const poll = async () => {
      try {
        const res = await fetch("/api/local/users");
        if (res.ok) {
          const list = await res.json();
          callback(list);
        }
      } catch (e) {
        console.warn("Offline user list poll exception:", e);
      }
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }
}

// 4. Subscribe to messages inside a specific room
export function subscribeMessages(chatId: string, callback: (messages: Message[]) => void): () => void {
  if (!isLocalMode()) {
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"), limit(50));
    return onSnapshot(
      q,
      (snapshot) => {
        const list: Message[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as Message);
        });
        callback(list);
      },
      (err) => console.error(`Firebase messages feed failed on ${chatId}`, err)
    );
  } else {
    const poll = async () => {
      try {
        const res = await fetch(`/api/local/chats/${chatId}/messages`);
        if (res.ok) {
          const list = await res.json();
          callback(list);
        }
      } catch (e) {
        console.warn("Offline messages poll exception:", e);
      }
    };
    poll();
    const interval = setInterval(poll, 2200); // Poll slightly faster for active chat feeds
    return () => clearInterval(interval);
  }
}

// 5. Subscribe to telegram configs
export function subscribeTelegramChannels(callback: (channels: any[]) => void): () => void {
  if (!isLocalMode()) {
    return onSnapshot(
      collection(db, "telegram_channels"),
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() });
        });
        callback(list);
      },
      (err) => console.error("Firebase tele list failed", err)
    );
  } else {
    const poll = async () => {
      try {
        const res = await fetch("/api/local/telegram_channels");
        if (res.ok) {
          const list = await res.json();
          callback(list);
        }
      } catch (e) {
        console.warn("Offline tele-config list exception:", e);
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }
}

// -------------------------------------------------------------
// Document Getters / Fetch requests
// -------------------------------------------------------------

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  if (!isLocalMode()) {
    const snap = await getDoc(doc(db, "users", userId));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as UserProfile) : null;
  } else {
    try {
      const res = await fetch(`/api/local/users/${userId}`);
      if (res.ok) return await res.json();
    } catch {
      return null;
    }
    return null;
  }
}

export async function fetchGroupMember(groupId: string, userId: string): Promise<GroupMember | null> {
  if (!isLocalMode()) {
    const snap = await getDoc(doc(db, "groups", groupId, "members", userId));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as unknown as GroupMember) : null;
  } else {
    try {
      const res = await fetch(`/api/local/groups/${groupId}/members/${userId}`);
      if (res.ok) return await res.json();
    } catch {
      return null;
    }
    return null;
  }
}

export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  if (!isLocalMode()) {
    try {
      const list: GroupMember[] = [];
      const qSnap = await getDocs(collection(db, "groups", groupId, "members"));
      qSnap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as unknown as GroupMember);
      });
      return list;
    } catch (e) {
      console.error("fetchGroupMembers failed on server:", e);
      return [];
    }
  } else {
    try {
      const res = await fetch(`/api/local/groups/${groupId}/members`);
      if (res.ok) return await res.json();
    } catch {
      return [];
    }
    return [];
  }
}

// -------------------------------------------------------------
// Document Writers / Set requests
// -------------------------------------------------------------

export async function saveUserProfile(
  userId: string,
  email: string,
  displayName: string,
  publicKey: string
): Promise<void> {
  if (!isLocalMode()) {
    await setDoc(
      doc(db, "users", userId),
      {
        id: userId,
        email,
        displayName,
        publicKey,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    const res = await fetch("/api/local/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: userId, email, displayName, publicKey }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || "Offline user registration failed");
    }
  }
}

export async function saveGroupMemberKey(
  groupId: string,
  userId: string,
  email: string,
  displayName: string,
  encryptedGroupKey: string
): Promise<void> {
  if (!isLocalMode()) {
    await setDoc(doc(db, "groups", groupId, "members", userId), {
      userId,
      email,
      displayName,
      encryptedGroupKey,
      createdAt: serverTimestamp(),
    });
  } else {
    const res = await fetch(`/api/local/groups/${groupId}/members/${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptedGroupKey, displayName, email }),
    });
    if (!res.ok) {
      throw new Error("Offline member key handoff failed");
    }
  }
}

export async function createGroup(
  id: string,
  name: string,
  description: string,
  createdBy: string,
  password?: string
): Promise<void> {
  if (!isLocalMode()) {
    await setDoc(doc(db, "groups", id), {
      id,
      name,
      description,
      password: password || "",
      createdBy,
      createdAt: serverTimestamp(),
    });
  } else {
    const res = await fetch("/api/local/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, description, password: password || "", createdBy }),
    });
    if (!res.ok) {
      throw new Error("Offline group creation failed");
    }
  }
}

export async function saveAllowedEmail(
  email: string,
  displayName: string
): Promise<void> {
  const cleanEmail = email.toLowerCase().trim();
  if (!isLocalMode()) {
    await setDoc(doc(db, "allowed_emails", cleanEmail), {
      email: cleanEmail,
      displayName,
      assignedGroups: [],
      createdAt: serverTimestamp(),
    });
  } else {
    const res = await fetch("/api/local/allowed_emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cleanEmail, displayName }),
    });
    if (!res.ok) {
      throw new Error("Offline whitelisting failed");
    }
  }
}

export async function deleteAllowedEmail(email: string): Promise<void> {
  const cleanEmail = email.toLowerCase().trim();
  if (!isLocalMode()) {
    await deleteDoc(doc(db, "allowed_emails", cleanEmail));
  } else {
    const res = await fetch(`/api/local/allowed_emails/${cleanEmail}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error("Offline whitelist deletion failed");
    }
  }
}

export async function toggleGroupAssignment(
  email: string,
  assignedGroups: string[]
): Promise<void> {
  const cleanEmail = email.toLowerCase().trim();
  if (!isLocalMode()) {
    await setDoc(
      doc(db, "allowed_emails", cleanEmail),
      { assignedGroups },
      { merge: true }
    );
  } else {
    // Local updates post allowed email details to update assignments
    const res = await fetch("/api/local/allowed_emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cleanEmail, assignedGroups }),
    });
    if (!res.ok) {
      throw new Error("Offline assignment fail");
    }
  }
}

export async function saveTelegramChannelConfig(
  id: string,
  displayName: string,
  description: string
): Promise<void> {
  const cleanId = id.trim().toLowerCase();
  if (!isLocalMode()) {
    await setDoc(doc(db, "telegram_channels", cleanId), {
      id: cleanId,
      displayName,
      description,
      createdAt: serverTimestamp(),
    });
  } else {
    const res = await fetch("/api/local/telegram_channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: cleanId, displayName, description }),
    });
    if (!res.ok) {
      throw new Error("Offline Telegram creation failed");
    }
  }
}

export async function deleteTelegramChannelConfig(id: string): Promise<void> {
  if (!isLocalMode()) {
    await deleteDoc(doc(db, "telegram_channels", id));
  } else {
    const res = await fetch(`/api/local/telegram_channels/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error("Offline Telegram deletion failed");
    }
  }
}

export async function dispatchMessage(
  chatId: string,
  messageId: string,
  messagePayload: {
    id: string;
    senderId: string;
    senderName: string;
    encryptedPayload: string;
    encryptedSymmetricKeys?: Record<string, string> | null;
    isGroup: boolean;
  }
): Promise<void> {
  if (!isLocalMode()) {
    await setDoc(doc(db, "chats", chatId, "messages", messageId), {
      ...messagePayload,
      createdAt: serverTimestamp(),
    });
  } else {
    const res = await fetch(`/api/local/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...messagePayload }),
    });
    if (!res.ok) {
      throw new Error("Offline dispatch error");
    }
  }
}
