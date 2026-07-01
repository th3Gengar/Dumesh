import React, { useState, useEffect } from "react";
import { AllowedEmail, Group, UserProfile } from "../types";
import { generateSymmetricKey, asymmetricallyEncrypt, arrayBufferToBase64 } from "../lib/crypto";
import {
  isLocalMode,
  subscribeAllowedEmails,
  subscribeGroups,
  subscribeUsers,
  subscribeTelegramChannels,
  saveAllowedEmail,
  deleteAllowedEmail,
  toggleGroupAssignment,
  createGroup,
  saveGroupMemberKey,
  fetchGroupMember,
  fetchGroupMembers,
  saveTelegramChannelConfig,
  deleteTelegramChannelConfig,
  getLocalSettings,
  setLocalSettings,
} from "../lib/dbBridge";
import { UserPlus, Users, Trash2, FolderSync, PlusCircle, Globe, RefreshCcw, KeyRound, Check, Settings } from "lucide-react";

interface AdminPanelProps {
  adminEmail: string;
}

export default function AdminPanel({ adminEmail }: AdminPanelProps) {
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<UserProfile[]>([]);
  const [dispatchedKeys, setDispatchedKeys] = useState<Record<string, string[]>>({});

  const loadAllGroupMembers = async () => {
    const newMap: Record<string, string[]> = {};
    for (const g of groups) {
      try {
        const members = await fetchGroupMembers(g.id);
        newMap[g.id] = members.map((m) => m.userId);
      } catch (e) {
        console.error("Failed to load members for group", g.id, e);
      }
    }
    setDispatchedKeys(newMap);
  };

  useEffect(() => {
    if (groups.length > 0) {
      loadAllGroupMembers();
    }
  }, [groups, registeredUsers]);
  
  // Forms state
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserDisplayName, setNewUserDisplayName] = useState("");
  
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupPassword, setNewGroupPassword] = useState("");

  const [newTelegramChannel, setNewTelegramChannel] = useState("");
  const [telegramChannels, setTelegramChannels] = useState<any[]>([]);

  // Feedback states
  const [userStatus, setUserStatus] = useState("");
  const [groupStatus, setGroupStatus] = useState("");
  const [telegramStatus, setTelegramStatus] = useState("");

  const [allowSelfJoin, setAllowSelfJoin] = useState(true);

  useEffect(() => {
    // Load emergency overrides if in local-LAN mode
    if (isLocalMode()) {
      getLocalSettings().then(s => setAllowSelfJoin(s.allowSelfAuthInEmergency));
    }

    // 1. Listen to Allowed Emails
    const unsubscribeEmails = subscribeAllowedEmails((list) => {
      setEmails(list);
    });

    // 2. Listen to Groups
    const unsubscribeGroups = subscribeGroups((list) => {
      setGroups(list);
    });

    // 3. Listen to Registered Users profiles (to fetch public keys for encryption)
    const unsubscribeUsers = subscribeUsers((list) => {
      setRegisteredUsers(list);
    });

    // 4. Listen to Telegram Channels config
    const unsubscribeTelegram = subscribeTelegramChannels((list) => {
      setTelegramChannels(list);
    });

    return () => {
      unsubscribeEmails();
      unsubscribeGroups();
      unsubscribeUsers();
      unsubscribeTelegram();
    };
  }, []);

  // --------------------------------------------------------
  // Section: Whitelist Email & Assign Groups
  // --------------------------------------------------------
  const handleAddAllowedEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserStatus("");
    const email = newUserEmail.trim().toLowerCase();
    const displayName = newUserDisplayName.trim();

    if (!email || !displayName) {
      setUserStatus("Please complete all user registration inputs.");
      return;
    }

    try {
      await saveAllowedEmail(email, displayName);
      setNewUserEmail("");
      setNewUserDisplayName("");
      setUserStatus(`User whitelisted successfully: ${email}`);
    } catch (err) {
      setUserStatus("Failed to whitelist email.");
    }
  };

  const handleRemoveAllowedEmail = async (email: string) => {
    try {
      await deleteAllowedEmail(email);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleGroupAssignment = async (email: string, groupId: string) => {
    const userToUpdate = emails.find((u) => u.email === email);
    if (!userToUpdate) return;

    let assigned = [...(userToUpdate.assignedGroups || [])];
    if (assigned.includes(groupId)) {
      assigned = assigned.filter((id) => id !== groupId);
    } else {
      assigned.push(groupId);
    }

    try {
      await toggleGroupAssignment(email, assigned);
    } catch (err) {
      console.error(err);
    }
  };

  // --------------------------------------------------------
  // --------------------------------------------------------
  // Section: Create Groups & Generate Group-Symmetric-Keys
  // --------------------------------------------------------
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setGroupStatus("");
    const name = newGroupName.trim();
    const desc = newGroupDesc.trim();

    if (!name) {
      setGroupStatus("Group name is required.");
      return;
    }

    const groupId = "g_" + Math.random().toString(36).substring(2, 11);

    try {
      // 1. Generate client-side AES group key
      const rawGroupAesKey = await generateSymmetricKey();
      const localAesKeyB64 = arrayBufferToBase64(rawGroupAesKey);

      // Save group key to local storage for the admin's own reference so they can encrypt/decrypt
      localStorage.setItem(`group_aes_key_${groupId}`, localAesKeyB64);

      // 2. Publish basic Group metadata via bridge
      await createGroup(groupId, name, desc, "admin", newGroupPassword.trim());

      // 3. Immediately register Admin as asymmetrically-encrypted member
      // Since admin is arshiashokoufezamir@gmail.com, find direct user profile for public key
      const adminProfile = registeredUsers.find((u) => u.email === adminEmail);
      if (adminProfile && adminProfile.publicKey) {
        const encryptedKeyForAdmin = await asymmetricallyEncrypt(adminProfile.publicKey, rawGroupAesKey);
        await saveGroupMemberKey(groupId, adminProfile.id, adminEmail, adminProfile.displayName, encryptedKeyForAdmin);
      }

      setNewGroupName("");
      setNewGroupDesc("");
      setNewGroupPassword("");
      setGroupStatus(`Group "${name}" established with a secure AES Key and password protection.`);
    } catch (err: any) {
      setGroupStatus(`Failed to generate Group: ${err.message}`);
    }
  };

  const handleRemoveGroup = async (groupId: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this room? This removes all historical messages.")) return;
    try {
      // Direct Firestore check
      if (isLocalMode()) {
        alert("Delete Room action is bypassed on Local-LAN during survival simulation.");
      } else {
        const { doc, deleteDoc } = await import("firebase/firestore");
        const { db } = await import("../lib/firebase");
        await deleteDoc(doc(db, "groups", groupId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --------------------------------------------------------
  // Section: Sync Member Key to Users In-Browser Asymmetrically
  // --------------------------------------------------------
  const handlePropagateGroupKey = async (email: string, group: Group) => {
    // 1. Verify user profile exists & has registered public key
    const userProfile = registeredUsers.find((u) => u.email === email);
    if (!userProfile || !userProfile.publicKey) {
      alert("This user has not signed in to initialize their cryptographic keypair yet.");
      return;
    }

    // 2. Load group’s symmetric key from Admin’s browser local storage
    const groupAesB64 = localStorage.getItem(`group_aes_key_${group.id}`);
    if (!groupAesB64) {
      // If admin opened app on a different browser, we must retrieve from and decrypt of admin member key!
      const adminProfile = registeredUsers.find((s) => s.email === adminEmail);
      if (!adminProfile) {
        alert("Unable to decrypt group key on this device: admin has no profile.");
        return;
      }
      try {
        const adminMemberData = await fetchGroupMember(group.id, adminProfile.id);
        if (!adminMemberData) {
          alert("Unable to locate group cryptographic key for propagation.");
          return;
        }
        const encAdminKey = adminMemberData.encryptedGroupKey;
        const adminPrivateJwk = localStorage.getItem(`e2e_private_key_${adminProfile.id}`);
        if (!adminPrivateJwk) {
          alert("Enter your secure private key backup first to authorize key propagation!");
          return;
        }
        // Decrypt admin key to recover raw AES, and cache/propagate
        const { asymmetricallyDecrypt } = await import("../lib/crypto");
        const decryptedRaw = await asymmetricallyDecrypt(adminPrivateJwk, encAdminKey);
        const recoveredB64 = arrayBufferToBase64(decryptedRaw);
        localStorage.setItem(`group_aes_key_${group.id}`, recoveredB64);
        alert("Secured credentials. Click 'Grant Key Access' again to complete synchronization!");
        return;
      } catch (err) {
        alert("Failed to recover Group keys. Is your current private key imported?");
        return;
      }
    }

    try {
      const rawSymmetricKey = new Uint8Array(
        typeof window === "undefined" ? [] : Array.from(atob(groupAesB64), (c) => c.charCodeAt(0))
      ).buffer;

      // Encrypt for new user's public key
      const userEncryptedKey = await asymmetricallyEncrypt(userProfile.publicKey, rawSymmetricKey);

      // Publish Member Document (grants E2E workspace entrance) via bridge
      await saveGroupMemberKey(group.id, userProfile.id, email, userProfile.displayName, userEncryptedKey);

      await loadAllGroupMembers();
      alert(`Encryption key securely dispatched to ${userProfile.displayName}!`);
    } catch (err: any) {
      alert(`Propagation failed: ${err.message}`);
    }
  };

  // --------------------------------------------------------
  // Section: Telegram Integration Channel management
  // --------------------------------------------------------
  const handleAddTelegramChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setTelegramStatus("");
    const handle = newTelegramChannel.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "");

    if (!handle) {
      setTelegramStatus("Invalid Telegram handle.");
      return;
    }

    try {
      await saveTelegramChannelConfig(
        handle,
        `@${handle}`,
        `Connected public Telegram feed from t.me/s/${handle}`
      );
      setNewTelegramChannel("");
      setTelegramStatus(`Public Tele-Channel connection registered: @${handle}`);
    } catch (err) {
      setTelegramStatus("Failed to link Telegram channel.");
    }
  };

  const handleRemoveTelegramChannel = async (handle: string) => {
    try {
      await deleteTelegramChannelConfig(handle);
    } catch (err) {
      console.error(err);
    }
  };

  // Identify registered users who visited but aren't whitelisted by admin yet
  const pendingUsers = registeredUsers.filter(
    (r) => !emails.some((u) => u.email.toLowerCase() === r.email.toLowerCase())
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Col 1: Authorized Whitelists & Visitor Queue */}
      <div className="space-y-6">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
          <div className="flex items-center space-x-2 text-white font-semibold mb-4">
            <UserPlus className="w-5 h-5 text-emerald-400" />
            <h3 className="tracking-wide">Whitelist & Authorize Users</h3>
          </div>

          {/* Pending Access requests queue */}
          {pendingUsers.length > 0 && (
            <div className="mb-6 p-4.5 bg-amber-950/20 border border-amber-900/40 rounded-xl space-y-3.5 shadow-inner">
              <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping inline-block" />
                <span>Pending Access Requests ({pendingUsers.length})</span>
              </div>
              <p className="text-[10.5px] text-neutral-450 leading-relaxed font-sans">
                These visiting network nodes have initialized their client-side RSA E2E keys and are waiting for administrative whitelist confirmation.
              </p>
              <div className="space-y-2">
                {pendingUsers.map((p) => (
                  <div key={p.id} className="p-3 bg-neutral-950/95 border border-neutral-850 rounded-lg flex items-center justify-between">
                    <div className="space-y-0.5 min-w-0 flex-1 pr-3">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-white truncate">{p.displayName}</span>
                        <span className="px-1.5 py-0.2 bg-emerald-950 border border-emerald-900/35 text-[8px] font-mono text-emerald-400 rounded">
                          KEY READY
                        </span>
                      </div>
                      <span className="text-[10.5px] text-neutral-500 font-mono truncate block">{p.email}</span>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await saveAllowedEmail(p.email, p.displayName);
                          setUserStatus(`Successfully approved & whitelisted: ${p.email}`);
                        } catch (e) {
                          console.error("Failed to approve pending user:", e);
                        }
                      }}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-neutral-950 text-[11px] font-bold rounded-lg transition-colors cursor-pointer shrink-0"
                    >
                      Approve Node
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleAddAllowedEmail} className="space-y-3 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="email"
                placeholder="Google Account Email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                className="px-3 py-2 bg-neutral-950 border border-neutral-800 text-sm text-neutral-200 rounded-lg focus:outline-none focus:border-neutral-700"
              />
              <input
                type="text"
                placeholder="User Screen Name"
                value={newUserDisplayName}
                onChange={(e) => setNewUserDisplayName(e.target.value)}
                className="px-3 py-2 bg-neutral-950 border border-neutral-800 text-sm text-neutral-200 rounded-lg focus:outline-none focus:border-neutral-700"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition cursor-pointer"
            >
              Whitelist & Invite User
            </button>
            {userStatus && <p className="text-xs text-amber-500 mt-2">{userStatus}</p>}
          </form>

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              Whitelisted Credentials ({emails.length})
            </h4>
            {emails.length === 0 ? (
              <p className="text-xs text-neutral-500 font-mono">No external users whitelisted yet.</p>
            ) : (
              emails.map((u) => {
                const userProfile = registeredUsers.find((r) => r.email.toLowerCase() === u.email.toLowerCase());
                const isRegistered = !!userProfile;
                const hasKey = !!userProfile?.publicKey;
                return (
                  <div
                    key={u.email}
                    className="p-3 bg-neutral-950 border border-neutral-850 rounded-lg flex items-center justify-between hover:border-neutral-750 transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-semibold text-white truncate">{u.displayName}</span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isRegistered ? "bg-emerald-400" : "bg-neutral-600"
                          }`}
                          title={isRegistered ? "Profile Synchronized" : "Uninitialized"}
                        />
                        {hasKey && (
                          <span className="text-[8px] bg-emerald-950 border border-emerald-500/25 text-emerald-400 font-mono px-1 rounded">
                            KEY READY
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-neutral-500 font-mono truncate block">{u.email}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveAllowedEmail(u.email)}
                      className="p-1.5 hover:bg-red-950/40 border border-transparent hover:border-red-900/30 rounded-md text-neutral-500 hover:text-red-400 transition cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {isLocalMode() && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
            <div className="flex items-center space-x-2 text-white font-semibold mb-2">
              <Settings className="w-5 h-5 text-amber-500" />
              <h3>LAN Grid Mesh Override</h3>
            </div>
            <p className="text-xs text-neutral-400 mb-4">
              In high-risk emergency situations, self-authenticating mesh overrides permit anyone on your offline network or local server to generate keys and communicate without prior whitelisting.
            </p>
            <label className="flex items-center space-x-3 bg-neutral-950 p-4 border border-neutral-850 rounded-xl cursor-pointer hover:border-neutral-700/60 transition select-none">
              <input
                type="checkbox"
                checked={allowSelfJoin}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setAllowSelfJoin(val);
                  await setLocalSettings({ allowSelfAuthInEmergency: val });
                }}
                className="w-4 h-4 text-emerald-600 border-neutral-800 rounded focus:ring-opacity-0 bg-neutral-900 focus:ring-0 accent-emerald-500"
              />
              <div>
                <p className="text-xs font-semibold text-white">Emergency Self-Authorization</p>
                <p className="text-[10px] text-neutral-500 mt-0.5">Permit new local devices to negotiate E2E keys dynamically</p>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Col 2: Chat Groups & Telegram Channels */}
      <div className="space-y-6">
        {/* Chat Groups Creator & group-centric Assignments */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
          <div className="flex items-center space-x-2 text-white font-semibold mb-4">
            <Users className="w-5 h-5 text-emerald-400" />
            <h3 className="tracking-wide font-bold">Secure Chat Groups</h3>
          </div>

          <form onSubmit={handleCreateGroup} className="space-y-3 mb-6">
            <input
              type="text"
              placeholder="Group Room Name (e.g., Safe Zone Delta)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 text-sm text-neutral-200 rounded-lg focus:outline-none focus:border-neutral-700"
            />
            <input
              type="text"
              placeholder="Short Description / Directives"
              value={newGroupDesc}
              onChange={(e) => setNewGroupDesc(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 text-sm text-neutral-200 rounded-lg focus:outline-none focus:border-neutral-700"
            />
            <input
              type="text"
              placeholder="Room Entrance Password (e.g. Secret123)"
              value={newGroupPassword}
              onChange={(e) => setNewGroupPassword(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-850 text-sm text-amber-300 placeholder-neutral-600 font-mono rounded-lg focus:outline-none focus:border-neutral-700"
              required
            />
            <button
              type="submit"
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition cursor-pointer"
            >
              Initialize Password Protected Group
            </button>
            {groupStatus && <p className="text-xs text-amber-500 mt-2">{groupStatus}</p>}
          </form>

          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
            <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              Active Server Groups ({groups.length})
            </h4>
            {groups.length === 0 ? (
              <p className="text-xs text-neutral-500 font-mono">No rooms generated.</p>
            ) : (
              groups.map((g) => {
                const membersList = dispatchedKeys[g.id] || [];
                return (
                  <div
                    key={g.id}
                    className="p-4 bg-neutral-950 border border-neutral-850 rounded-xl space-y-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <h5 className="text-sm font-bold text-white tracking-wide">{g.name}</h5>
                        <p className="text-xs text-neutral-450 leading-relaxed">{g.description || "No description / instructions."}</p>
                        <div className="flex items-center space-x-2.5 pt-1.5">
                          <span className="text-[9px] font-mono text-neutral-550">ROOM ID: {g.id}</span>
                          {g.password && (
                            <span className="text-[9px] font-mono text-amber-400 bg-amber-950/25 px-1.5 py-0.3 rounded border border-amber-900/45">
                              PASSWORD: {g.password}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveGroup(g.id)}
                        className="p-1.5 hover:bg-red-950/40 border border-transparent hover:border-red-900/35 rounded-md text-neutral-500 hover:text-red-400 transition cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Member Assign & Access dispatcher frame */}
                    <div className="bg-neutral-900 border border-neutral-850 rounded-xl p-3.5 space-y-3.5">
                      <div className="flex justify-between items-center pb-2 border-b border-neutral-850">
                        <span className="text-[10.5px] font-mono text-neutral-400 uppercase tracking-widest block">Configure Mesh Node Entrance</span>
                        <span className="text-[10px] text-zinc-550 font-mono">Dispatched Key Nodes: {membersList.length}</span>
                      </div>
                      
                      {emails.length === 0 ? (
                        <p className="text-[11px] text-neutral-500 italic pb-0.5">Please whitelist or approve user profiles to configure group access.</p>
                      ) : (
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                          {emails.map((u) => {
                            const isAssigned = (u.assignedGroups || []).includes(g.id);
                            const userProfile = registeredUsers.find((r) => r.email.toLowerCase() === u.email.toLowerCase());
                            const hasPubKey = !!userProfile?.publicKey;
                            const keyDispatched = userProfile ? membersList.includes(userProfile.id) : false;

                            return (
                              <div
                                key={u.email}
                                className="flex items-center justify-between p-2.5 bg-neutral-950/70 border border-neutral-850/60 rounded-lg hover:border-neutral-750 transition-colors"
                              >
                                <label className="flex items-center space-x-2.5 select-none cursor-pointer flex-1 min-w-0 pr-3">
                                  <input
                                    type="checkbox"
                                    checked={isAssigned}
                                    onChange={() => handleToggleGroupAssignment(u.email, g.id)}
                                    className="w-4 h-4 rounded text-emerald-600 border-neutral-800 bg-neutral-900 focus:ring-opacity-0 focus:ring-0 accent-emerald-500"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span className="text-xs font-semibold text-white truncate block">{u.displayName}</span>
                                    <span className="text-[10.5px] text-neutral-500 font-mono truncate block">{u.email}</span>
                                  </div>
                                </label>

                                <div className="shrink-0 flex items-center">
                                  {isAssigned ? (
                                    hasPubKey ? (
                                      <div className="flex items-center space-x-2">
                                        <span className={`text-[9.5px] font-medium font-mono px-2 py-0.5 rounded border ${
                                          keyDispatched 
                                            ? "bg-emerald-950/50 border-emerald-900/40 text-emerald-400" 
                                            : "bg-amber-950/50 border-amber-900/40 text-amber-400 animate-pulse"
                                        }`}>
                                          {keyDispatched ? "DISPATCHED" : "KEY PENDING"}
                                        </span>
                                        <button
                                          onClick={() => handlePropagateGroupKey(u.email, g)}
                                          className={`px-2 py-1 rounded text-[10px] font-semibold transition border flex items-center space-x-1 cursor-pointer ${
                                            keyDispatched
                                              ? "bg-neutral-850 hover:bg-neutral-750 text-neutral-300 border-neutral-700"
                                              : "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500"
                                          }`}
                                          title={keyDispatched ? "Redistribute Encryption Keys" : "Dispatch AES Encryption Key"}
                                        >
                                          <KeyRound className="w-3 h-3" />
                                          <span>{keyDispatched ? "Sync" : "Grant Key"}</span>
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-neutral-500 font-mono italic">
                                        ⏳ Setup Keys
                                      </span>
                                    )
                                  ) : (
                                    <span className="text-[10px] text-neutral-600 font-mono italic">
                                      Not Assigned
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Telegram Channels Management */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
          <div className="flex items-center space-x-2 text-white font-semibold mb-4">
            <Globe className="w-5 h-5 text-emerald-400" />
            <h3 className="tracking-wide">Channel Syncer (Telegram Preview)</h3>
          </div>

          <form onSubmit={handleAddTelegramChannel} className="space-y-3 mb-6">
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="Telegram Username (e.g. durov)"
                value={newTelegramChannel}
                onChange={(e) => setNewTelegramChannel(e.target.value)}
                className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 text-sm text-neutral-200 rounded-lg focus:outline-none focus:border-neutral-700"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition cursor-pointer"
              >
                Register
              </button>
            </div>
            {telegramStatus && <p className="text-xs text-amber-500 mt-2">{telegramStatus}</p>}
          </form>

          <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
            <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              Synced Telegram Feeds ({telegramChannels.length})
            </h4>
            {telegramChannels.length === 0 ? (
              <p className="text-xs text-neutral-500 font-mono">No public channels configured.</p>
            ) : (
              telegramChannels.map((c) => (
                <div
                  key={c.id}
                  className="p-3 bg-neutral-950 border border-neutral-850 rounded-lg flex items-center justify-between hover:border-neutral-750 transition-colors"
                >
                  <div>
                    <h5 className="text-sm font-semibold text-white">{c.displayName}</h5>
                    <p className="text-xs text-neutral-550">{c.description}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveTelegramChannel(c.id)}
                    className="p-1.5 hover:bg-red-950/40 border border-transparent hover:border-red-900/30 rounded-md text-neutral-500 hover:text-red-400 transition cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
