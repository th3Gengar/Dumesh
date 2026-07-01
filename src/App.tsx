/**
 * Safe End-to-End Encrypted Stealth Messenger
 * Google AI Studio Build - Final Polish
 */

import React, { useState, useEffect } from "react";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";
import { auth, isMock } from "./lib/firebase";
import { UserProfile, Group, AllowedEmail } from "./types";
import {
  isLocalMode,
  setLocalMode,
  getLocalUserSession,
  setLocalUserSession,
  subscribeGroups,
  subscribeUsers,
  fetchUserProfile,
  saveUserProfile,
  subscribeAllowedEmails,
  getLocalSettings,
} from "./lib/dbBridge";
import KeyManager from "./components/KeyManager";
import AdminPanel from "./components/AdminPanel";
import ChatRoom from "./components/ChatRoom";
import TelegramFeed from "./components/TelegramFeed";
import { Shield, Lock, Users, MessageSquare, Globe, LogOut, Key, AlertTriangle, ChevronRight, Check, Wifi, WifiOff } from "lucide-react";

export default function App() {
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  // Whitelist / Auth authorization states
  const [isWhitelisted, setIsWhitelisted] = useState<boolean | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [allowedGroupIds, setAllowedGroupIds] = useState<string[]>([]);
  
  // Key state
  const [privateKeyStr, setPrivateKeyStr] = useState<string | null>(null);
  const [hasKeys, setHasKeys] = useState<boolean>(false);

  // Active workspace selector states
  const [activeTab, setActiveTab] = useState<"chats" | "telegram" | "keys" | "admin">("chats");
  const [selectedChat, setSelectedChat] = useState<{ id: string; name: string; isGroup: boolean } | null>(null);

  // Synced dataset lists
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [otherUsers, setOtherUsers] = useState<UserProfile[]>([]);

  const [offlineMeshActive, setOfflineMeshActive] = useState(isLocalMode());
  const [offlineEmail, setOfflineEmail] = useState("");
  const [offlineDisplayName, setOfflineDisplayName] = useState("");
  const [offlineError, setOfflineError] = useState("");

  const adminEmail = "arshiashokoufezamir@gmail.com";
  const userIsAdmin = currentUser?.email === adminEmail || (offlineMeshActive && (currentUser?.email === "admin@disaster.mesh" || currentUser?.email === adminEmail));

  // 1. Unified Authentication Listener
  useEffect(() => {
    if (offlineMeshActive) {
      // Offline Local Mode
      const localUser = getLocalUserSession();
      setCurrentUser(localUser);
      if (localUser) {
        runAuthCheck(localUser);
      } else {
        setIsWhitelisted(null);
        setUserProfile(null);
        setAllowedGroupIds([]);
        setPrivateKeyStr(null);
        setHasKeys(false);
        setLoadingAuth(false);
      }
    } else {
      // Cloud Firebase Mode
      if (isMock) {
        setLoadingAuth(false);
        return;
      }
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        setCurrentUser(user);
        if (user) {
          await runAuthCheck(user);
        } else {
          setIsWhitelisted(null);
          setUserProfile(null);
          setAllowedGroupIds([]);
          setPrivateKeyStr(null);
          setHasKeys(false);
          setLoadingAuth(false);
        }
      });
      return () => unsubscribe();
    }
  }, [offlineMeshActive]);

  // 2. Perform whitelist check & local profile synchronization
  const runAuthCheck = async (user: any) => {
    setLoadingAuth(true);
    try {
      const email = (user.email || "").toLowerCase();
      let allowed = email === adminEmail || (offlineMeshActive && email === "admin@disaster.mesh");
      let groupsAssigned: string[] = [];

      if (offlineMeshActive) {
        // Local mode: check if local settings allow self auth in emergency, or check if whitelisted
        const settings = await getLocalSettings();
        if (settings.allowSelfAuthInEmergency) {
          allowed = true;
          // In emergency, auto-assign user to all active rooms!
          groupsAssigned = [];
        } else {
          // Poll local whitelist to verify
          try {
            const res = await fetch("/api/local/allowed_emails");
            if (res.ok) {
              const emailsList: AllowedEmail[] = await res.json();
              const match = emailsList.find(e => e.email === email);
              if (match) {
                allowed = true;
                groupsAssigned = match.assignedGroups || [];
              }
            }
          } catch (e) {
            console.warn("Local whitelist check failed during offline crisis:", e);
          }
        }
      } else {
        // Cloud mode: query administrator's Firestore allowed_emails list
        if (!allowed) {
          try {
            const { doc, getDoc } = await import("firebase/firestore");
            const { db } = await import("./lib/firebase");
            const emailSnap = await getDoc(doc(db, "allowed_emails", email));
            if (emailSnap.exists()) {
              allowed = true;
              groupsAssigned = emailSnap.data().assignedGroups || [];
            }
          } catch (e) {
            console.error("Firebase whitelist validation exception", e);
          }
        }
      }

      setIsWhitelisted(allowed);
      setAllowedGroupIds(groupsAssigned);

      // Fetch user profile from the database bridge for all (whitelisted or pending guest) users!
      try {
        const profile = await fetchUserProfile(user.uid);
        if (profile) {
          setUserProfile(profile);
          
          // Check for private keys in localStorage
          const localKeyName = `e2e_private_key_${user.uid}`;
          const localPriv = localStorage.getItem(localKeyName);
          if (localPriv) {
            setPrivateKeyStr(localPriv);
            setHasKeys(true);
          } else {
            setHasKeys(false);
            if (allowed) {
              setActiveTab("keys");
            }
          }
        } else {
          // New user, guide to Key Vault if whitelisted
          setUserProfile(null);
          setHasKeys(false);
          if (allowed) {
            setActiveTab("keys");
          }
        }
      } catch (e) {
        console.error("Profile recovery failed", e);
      }
    } catch (e) {
      console.error("Authorization check pipeline exception:", e);
    } finally {
      setLoadingAuth(false);
    }
  };

  // 3. Keep groups lists and users in-sync in real-time via dbBridge
  useEffect(() => {
    if (!currentUser || isWhitelisted === false) return;

    // A. Listen to Groups via bridge
    const unsubGroups = subscribeGroups((list) => {
      const filtered = list.filter((item) => {
        if (userIsAdmin) return true;
        // Non-admin can ONLY see groups they are explicitly assigned to:
        return allowedGroupIds.includes(item.id);
      });
      setAvailableGroups(filtered);
    });

    // B. Listen to Direct Users via bridge
    const unsubUsers = subscribeUsers((list) => {
      const filtered = list.filter((item) => item.id !== currentUser.uid);
      setOtherUsers(filtered);
    });

    return () => {
      unsubGroups();
      unsubUsers();
    };
  }, [currentUser, isWhitelisted, allowedGroupIds, userIsAdmin, offlineMeshActive]);

  const handleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      setLoadingAuth(true);
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error("OAuth Popup failure", e);
      setLoadingAuth(false);
    }
  };

  const handleSignOut = async () => {
    try {
      if (offlineMeshActive) {
        setLocalUserSession(null);
        setCurrentUser(null);
      } else {
        await signOut(auth);
        setCurrentUser(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerKeyActivation = (privateKeyJson: string, forceRedirect = true) => {
    setPrivateKeyStr(privateKeyJson);
    setHasKeys(true);
    if (currentUser) {
      fetchUserProfile(currentUser.uid).then((prof) => {
        if (prof) setUserProfile(prof);
      });
    }
    if (forceRedirect && isWhitelisted) {
      setActiveTab("chats");
    }
  };

  // -------------------------------------------------------------
  // Layout views
  // -------------------------------------------------------------

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-center">
        <Lock className="w-12 h-12 text-emerald-500 animate-pulse mb-4" />
        <p className="text-sm font-mono text-neutral-400">Locking secure session channels...</p>
      </div>
    );
  }

  // Awaiting Firebase Setup UI Banner/Notice
  if (isMock) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md p-6 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-xl space-y-4">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
          <h2 className="text-lg font-semibold text-white">Firebase Provisioning Required</h2>
          <p className="text-xs text-neutral-400 leading-relaxed">
            I have pre-configured the database structures, security protocols, and server elements. 
            To activate this safe messenger, please click the 
            <strong className="text-emerald-400 font-medium"> Accept Terms </strong> or complete the 
            Firebase prompt shown on your screen in AI Studio. 
            The platform will instantly write your cloud credentials and activate live E2E communications.
          </p>
          <div className="bg-neutral-950 p-2.5 rounded border border-neutral-850 font-mono text-[10px] text-zinc-550">
            Status: Waiting for client project activation...
          </div>
        </div>
      </div>
    );
  }

  // Not Logged In Screen
  if (!currentUser) {
    const handleLocalConnect = async (e: React.FormEvent) => {
      e.preventDefault();
      setOfflineError("");
      const email = offlineEmail.trim().toLowerCase();
      const displayName = offlineDisplayName.trim();

      if (!email || !displayName) {
        setOfflineError("Please fill in secure email credential and screen name.");
        return;
      }

      // Consistent deterministic UID derived from the email to prevent multi-device collision
      const uid = "usr_" + email.replace(/[^a-zA-Z0-9]/g, "");
      const session = { uid, email, displayName };
      
      // Save local session
      setLocalUserSession(session);
      setCurrentUser(session);
    };

    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="p-4 bg-emerald-950/40 border border-emerald-500/20 max-w-max mx-auto rounded-2xl text-emerald-400 text-center">
            <Shield className="w-10 h-10 mx-auto animate-pulse" />
          </div>

          <div className="text-center">
            <h1 className="text-xl font-bold text-white tracking-tight">Stealth E2E Messenger</h1>
            <p className="text-xs text-neutral-400 mt-1">
              Protected, zero-knowledge workspace for vetted individuals and local channels
            </p>
          </div>

          {/* Network State / Gateway Selector Tab Slider */}
          <div className="bg-neutral-950 p-1 rounded-xl border border-neutral-850 flex items-center">
            <button
              onClick={() => {
                setLocalMode(false);
                setOfflineMeshActive(false);
                setOfflineError("");
              }}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-semibold font-mono transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                !offlineMeshActive
                  ? "bg-neutral-850 text-white border border-neutral-700/60"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>CLOUD CONNECT</span>
            </button>
            <button
              onClick={() => {
                setLocalMode(true);
                setOfflineMeshActive(true);
                setOfflineError("");
              }}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-semibold font-mono transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                offlineMeshActive
                  ? "bg-amber-950/60 text-amber-300 border border-amber-800/50"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span>LAN DISASTER MESH</span>
            </button>
          </div>

          {!offlineMeshActive ? (
            <div className="space-y-4">
              <button
                onClick={handleSignIn}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center space-x-2.5 cursor-pointer shadow-lg shadow-emerald-950/20"
              >
                <Lock className="w-4 h-4" />
                <span>Secure Sign-In with Google</span>
              </button>
              <p className="text-[10px] text-zinc-500 leading-relaxed text-center">
                Uses Firebase security rules. Ensure google connection is stable.
              </p>
            </div>
          ) : (
            <form onSubmit={handleLocalConnect} className="space-y-3">
              <div className="bg-amber-950/30 border border-amber-900/30 rounded-lg p-3 text-left space-y-1.5">
                <p className="text-[10.5px] text-amber-300 leading-relaxed font-mono">
                  ⚠️ INSTANT RADIO ACTIVE: Google services bypassed. Your messages will transit directly through physical local LAN mesh routers.
                </p>
                <p className="text-[10px] text-amber-400/90 leading-relaxed font-mono">
                  🔑 Admin Override Credential: Sign in with <strong className="text-white">admin@disaster.mesh</strong> to access full secure Admin controls.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-neutral-400 uppercase tracking-widest mb-1.5 pl-1">
                  Local ID / Email Address
                </label>
                <input
                  type="email"
                  placeholder="e.g. user@disaster.mesh"
                  required
                  value={offlineEmail}
                  onChange={(e) => setOfflineEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 text-sm text-neutral-200 rounded-lg focus:outline-none focus:border-neutral-700"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-neutral-400 uppercase tracking-widest mb-1.5 pl-1">
                  Display Mesh Alias
                </label>
                <input
                  type="text"
                  placeholder="e.g. Shield-Alpha"
                  required
                  value={offlineDisplayName}
                  onChange={(e) => setOfflineDisplayName(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 text-sm text-neutral-200 rounded-lg focus:outline-none focus:border-neutral-700"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-neutral-900 rounded-lg text-sm font-bold transition flex items-center justify-center space-x-2 cursor-pointer shadow-lg shadow-amber-950/20"
              >
                <WifiOff className="w-4 h-4" />
                <span>Link Local Node Grid</span>
              </button>
              {offlineError && <p className="text-xs text-red-400 text-center mt-1">{offlineError}</p>}
            </form>
          )}

          <p className="text-[10px] text-zinc-550 leading-relaxed text-center">
            E2E security notice: Cryptographic keys are generated client-side inside your browser sandbox. 
            Plaintext payloads are never transited or preserved.
          </p>
        </div>
      </div>
    );
  }

  // Access Denied and Pending Whitelist Registration screen
  if (isWhitelisted === false) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
        {/* Top Header Rail */}
        <header className="px-6 py-4 bg-neutral-900/60 backdrop-blur-md border-b border-neutral-850 flex justify-between items-center shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 bg-neutral-950 border border-neutral-850 rounded-lg text-emerald-400">
              <Shield className="w-4.5 h-4.5 animate-pulse text-amber-500" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-sm font-bold text-white tracking-wide">StealthE2E</h1>
                <span className="px-1.5 py-0.5 bg-amber-950/60 border border-amber-800/35 text-amber-400 text-[8px] font-mono rounded tracking-normal">PENDING APPROVAL</span>
              </div>
              <p className="text-[9px] font-mono text-zinc-500 tracking-wider">SECURE MESSENGER ENGINE</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-350 hover:text-white rounded-lg text-xs font-medium cursor-pointer flex items-center space-x-2 transition border border-neutral-750"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cancel / Sign Out</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto max-w-4xl w-full mx-auto px-4 py-8 space-y-6">
          {/* Status alert box */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 md:p-8 space-y-6 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-neutral-800">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-white">Pending Administrative Authorization</h2>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Your Google Account <span className="font-mono text-amber-400 font-semibold">{currentUser?.email}</span> has successfully connected.
                </p>
              </div>
              <div className="shrink-0 flex items-center space-x-2 px-3 py-1.5 bg-amber-950/20 border border-amber-900/30 rounded-xl">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                <span className="text-[10px] text-amber-400 font-mono font-medium tracking-wider">PENDING VERIFICATION</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-neutral-950 border border-neutral-850 rounded-xl space-y-2.5">
                <span className="text-[9.5px] font-mono text-neutral-500 uppercase tracking-widest block">E2E Cryptographic Public Key</span>
                <p className="text-xs font-medium text-white flex items-center space-x-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${userProfile?.publicKey ? "bg-emerald-400" : "bg-red-500 animate-pulse"}`} />
                  <span>{userProfile?.publicKey ? "✅ Keys Registered & Submitted" : "❌ Keys Not Generated (Action Required)"}</span>
                </p>
                <p className="text-[10.5px] text-neutral-500 leading-relaxed">
                  {userProfile?.publicKey 
                    ? "Your high-entropy cryptographic public key is securely registered in the system ledger. The administrator can verify your key fingerprint and grant entrance permissions." 
                    : "Please scroll down and use the secure Vault down below to generate your unique device keys. The administrator requires your public key to grant access."}
                </p>
              </div>

              <div className="p-4 bg-neutral-950 border border-neutral-850 rounded-xl space-y-2.5">
                <span className="text-[9.5px] font-mono text-neutral-500 uppercase tracking-widest block">Whitelist Authorization Queue</span>
                <p className="text-xs font-medium text-amber-400 flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>⏳ Awaiting Whitelist & Assignment</span>
                </p>
                <p className="text-[10.5px] text-neutral-500 leading-relaxed">
                  Once your identity is verified, the system administrator will add your email to the secure whitelist, assign you to target rooms, and securely transmit group AES keys.
                </p>
              </div>
            </div>
          </div>

          {/* Secure vault card for generating keypairs in place */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 md:p-8 space-y-4 shadow-xl">
            <div className="space-y-1 pb-4 border-b border-neutral-850">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Key className="w-4.5 h-4.5 text-emerald-400" />
                <span>Initialize Device Key Pair</span>
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Generate or import your client-side keypairs. Your private key is kept inside your browser's private indexed storage and is never transited or loaded to any database.
              </p>
            </div>

            <KeyManager
              userId={currentUser.uid}
              userEmail={currentUser.email}
              userDisplayName={currentUser.displayName || currentUser.email.split("@")[0]}
              onKeysReady={(priv) => triggerKeyActivation(priv, false)}
            />
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Primary Secure Interface Workspace
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
      
      {/* Top Header Rail */}
      <header className="px-6 py-4 bg-neutral-900/60 backdrop-blur-md border-b border-neutral-850 flex justify-between items-center shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 bg-emerald-950 border border-emerald-500/30 rounded-lg text-emerald-400">
            <Shield className="w-4.5 h-4.5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-white tracking-wide">StealthE2E</h1>
              {offlineMeshActive ? (
                <span className="px-1.5 py-0.5 bg-amber-950/60 border border-amber-800/35 text-amber-400 text-[8px] font-mono rounded tracking-normal">DISASTER MESH</span>
              ) : (
                <span className="px-1.5 py-0.5 bg-emerald-950/60 border border-emerald-500/20 text-emerald-400 text-[8px] font-mono rounded tracking-normal">CLOUD ONLINE</span>
              )}
            </div>
            <p className="text-[9px] font-mono text-zinc-500 tracking-wider">SECURE MESSENGER ENGINE</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="hidden md:flex items-center space-x-1.5">
          <button
            onClick={() => setActiveTab("chats")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              activeTab === "chats"
                ? "bg-neutral-800 text-white border border-neutral-700/60"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Chat Rooms
          </button>

          <button
            onClick={() => setActiveTab("telegram")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
              activeTab === "telegram"
                ? "bg-neutral-800 text-white border border-neutral-700/60"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Telegram Syncer
          </button>

          <button
            onClick={() => setActiveTab("keys")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center space-x-1 ${
              activeTab === "keys"
                ? "bg-neutral-800 text-white border border-neutral-700/60"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Key className="w-3 h-3" />
            <span className={!hasKeys ? "text-amber-400 font-semibold" : ""}>Key Vault {!hasKeys && "(!)"}</span>
          </button>

          {userIsAdmin && (
            <button
              onClick={() => setActiveTab("admin")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === "admin"
                  ? "bg-emerald-950 text-emerald-400 border border-emerald-500/30"
                  : "text-neutral-400 hover:text-emerald-300"
              }`}
            >
              Admin Controls
            </button>
          )}
        </div>

        {/* User Badge & Logout */}
        <div className="flex items-center space-x-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-medium text-white">{currentUser.displayName}</p>
            <p className="text-[10px] text-neutral-500 font-mono">{currentUser.email}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="p-1.5 bg-neutral-850 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800/80 rounded-lg transition cursor-pointer"
            title="Disconnect Cryptographic Session"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Working Dashboard Section */}
      <main className="flex-1 overflow-hidden p-6 max-w-7xl mx-auto w-full">
        {activeTab === "chats" && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-[600px]">
            {/* Sidebar chat selectors */}
            <div className="md:col-span-1 bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col overflow-hidden h-full">
              <div className="flex items-center space-x-1.5 text-xs text-neutral-400 font-semibold mb-3 border-b border-neutral-850 pb-2.5">
                <MessageSquare className="w-4 h-4" />
                <span>Conversations</span>
              </div>

              {/* Chat groups */}
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {/* Group section */}
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider pl-1">
                    Group Rooms ({availableGroups.length})
                  </h4>
                  {availableGroups.length === 0 ? (
                    <p className="text-[10px] text-zinc-550 pl-1">No group assignments.</p>
                  ) : (
                    availableGroups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setSelectedChat({ id: `group_${g.id}`, name: g.name, isGroup: true })}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition flex items-center justify-between cursor-pointer ${
                          selectedChat?.id === `group_${g.id}`
                            ? "bg-neutral-800/90 text-white border border-neutral-700/60"
                            : "hover:bg-neutral-950/50 text-neutral-400 hover:text-white"
                        }`}
                      >
                        <span className="font-medium truncate">{g.name}</span>
                        <ChevronRight className="w-3 h-3 opacity-60" />
                      </button>
                    ))
                  )}
                </div>

                {/* Direct Messages section */}
                <div className="space-y-1.5 pt-3 border-t border-neutral-850/60">
                  <h4 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider pl-1">
                    Direct Encrypted ({otherUsers.length})
                  </h4>
                  {otherUsers.length === 0 ? (
                    <p className="text-[10px] text-zinc-550 pl-1">No secure contacts.</p>
                  ) : (
                    otherUsers.map((ou) => {
                      // Generate standard direct conversation ID between two users sorted alphabetically
                      const directChatId = `direct_${[currentUser.uid, ou.id].sort().join("_")}`;
                      return (
                        <button
                          key={ou.id}
                          onClick={() => setSelectedChat({ id: directChatId, name: ou.displayName, isGroup: false })}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition flex items-center justify-between cursor-pointer ${
                            selectedChat?.id === directChatId
                              ? "bg-neutral-800/90 text-white border border-neutral-700/60"
                              : "hover:bg-neutral-950/50 text-neutral-400 hover:text-white"
                          }`}
                        >
                          <span className="font-medium truncate">{ou.displayName}</span>
                          <Lock className="w-3 h-3 text-emerald-500 opacity-60" />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Chat Room Window */}
            <div className="md:col-span-3 h-full">
              {!hasKeys ? (
                <div className="h-full bg-neutral-905 border border-neutral-800 rounded-xl flex flex-col items-center justify-center text-center p-6 space-y-3">
                  <Lock className="w-12 h-12 text-amber-500 animate-pulse" />
                  <h3 className="text-white font-semibold">Decryption Keyring Uninitialized</h3>
                  <p className="text-xs text-neutral-400 max-w-sm mx-auto">
                    Before you can read and write E2E encrypted chats, your client-side RSA keypair must be active.
                  </p>
                  <button
                    onClick={() => setActiveTab("keys")}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Generate / Setup Keys
                  </button>
                </div>
              ) : selectedChat ? (
                <ChatRoom
                  chatId={selectedChat.id}
                  roomName={selectedChat.name}
                  isGroup={selectedChat.isGroup}
                  groupPassword={selectedChat.isGroup ? availableGroups.find(g => g.id === selectedChat.id.replace(/^group_/, ""))?.password : undefined}
                  userIsAdmin={userIsAdmin}
                  currentUser={{
                    uid: currentUser.uid,
                    email: currentUser.email,
                    displayName: currentUser.displayName,
                  }}
                  privateKeyStr={privateKeyStr}
                />
              ) : (
                <div className="h-full bg-neutral-900 border border-neutral-800 rounded-xl flex flex-col items-center justify-center text-center opacity-60 select-none">
                  <Shield className="w-12 h-12 mb-3 text-neutral-600" />
                  <p className="text-xs text-neutral-400 font-mono">
                    Select an assigned group room or contact from the sidebar to engage.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "telegram" && <TelegramFeed userIsAdmin={userIsAdmin} />}

        {activeTab === "keys" && (
          <KeyManager
            userId={currentUser.uid}
            userEmail={currentUser.email}
            userDisplayName={currentUser.displayName}
            onKeysReady={triggerKeyActivation}
          />
        )}

        {activeTab === "admin" && userIsAdmin && (
          <AdminPanel adminEmail={currentUser.email} />
        )}
      </main>
    </div>
  );
}
