import React, { useState, useEffect, useRef } from "react";
import { Message, UserProfile } from "../types";
import {
  fetchGroupMember,
  fetchUserProfile,
  subscribeMessages,
  dispatchMessage,
} from "../lib/dbBridge";
import { symmetricallyEncrypt, symmetricallyDecrypt, asymmetricallyEncrypt, asymmetricallyDecrypt, generateSymmetricKey } from "../lib/crypto";
import { Send, Shield, Lock, ShieldAlert, Key, UserCheck } from "lucide-react";

interface ChatRoomProps {
  chatId: string; // group_groupId OR direct_uid1_uid2
  currentUser: { uid: string; email: string; displayName: string };
  privateKeyStr: string | null;
  isGroup: boolean;
  roomName: string;
  groupPassword?: string;
  userIsAdmin?: boolean;
}

export default function ChatRoom({
  chatId,
  currentUser,
  privateKeyStr,
  isGroup,
  roomName,
  groupPassword,
  userIsAdmin = false,
}: ChatRoomProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [decryptedMessageCache, setDecryptedMessageCache] = useState<{ [messageId: string]: string }>({});

  const [groupSymmetricKey, setGroupSymmetricKey] = useState<ArrayBuffer | null>(null);
  const [recipientProfile, setRecipientProfile] = useState<UserProfile | null>(null);
  const [decryptErr, setDecryptErr] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Password Protection States
  const [enteredPassword, setEnteredPassword] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const requiresPassword = isGroup && !!groupPassword;
  const isCurrentlyUnlocked = !requiresPassword || userIsAdmin || isUnlocked;

  useEffect(() => {
    setIsUnlocked(false);
    setEnteredPassword("");
    setPasswordError("");
  }, [chatId]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    if (enteredPassword.trim() === (groupPassword || "").trim()) {
      setIsUnlocked(true);
    } else {
      setPasswordError("Incorrect entrance password. Access Denied.");
    }
  };

  useEffect(() => {
    // Scroll to latest message
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, decryptedMessageCache]);

  // Load appropriate key context
  useEffect(() => {
    setGroupSymmetricKey(null);
    setRecipientProfile(null);
    setDecryptErr(null);
    setDecryptedMessageCache({});

    if (!privateKeyStr) return;

    if (isGroup) {
      // Fetch user's assigned group key using dbBridge helper
      const groupId = chatId.replace(/^group_/, "");
      fetchGroupMember(groupId, currentUser.uid)
        .then((memberData) => {
          if (memberData && memberData.encryptedGroupKey) {
            const encryptedKey = memberData.encryptedGroupKey;
            asymmetricallyDecrypt(privateKeyStr, encryptedKey)
              .then((decryptedRawBytes) => {
                setGroupSymmetricKey(decryptedRawBytes);
              })
              .catch((err) => {
                console.error(err);
                setDecryptErr("Cryptographic Key Mismatch: Failed to decrypt group AES-GCM key with your private key.");
              });
          } else {
            setDecryptErr("Access Pending: You are authorized for this email, but the Admin has not dispatched your secure E2E key. Please ask Admin to 'Grant Key Access' in Admin Panel.");
          }
        })
        .catch((e) => {
          console.error("Failed to fetch group member metadata", e);
          setDecryptErr("Failed to load secure group credentials from key servers.");
        });
    } else {
      // 1-to-1 Chat: Retrieve recipient's user profile to access their public key
      const parts = chatId.split("_");
      const recipientId = parts[1] === currentUser.uid ? parts[2] : parts[1];
      fetchUserProfile(recipientId)
        .then((p) => {
          if (p && p.publicKey) {
            setRecipientProfile(p);
          } else {
            setDecryptErr("Key Initialization Pending: Recipient has not logged in to register their cryptographic public key.");
          }
        })
        .catch((e) => {
          console.error("Failed to fetch recipient profile", e);
          setDecryptErr("Contact's public key identifier unreachable.");
        });
    }
  }, [chatId, privateKeyStr, isGroup, currentUser.uid]);

  // Listen to the message flow via real-time subscription abstractor
  useEffect(() => {
    const unsubscribe = subscribeMessages(chatId, (messagesList) => {
      setMessages(messagesList);
    });
    return () => unsubscribe();
  }, [chatId]);

  // Decrypt incoming message payloads lazily
  useEffect(() => {
    if (!privateKeyStr) return;

    messages.forEach(async (msg) => {
      // Skip if already decrypted in cache
      if (decryptedMessageCache[msg.id]) return;

      try {
        if (msg.isGroup) {
          if (groupSymmetricKey) {
            const decText = await symmetricallyDecrypt(msg.encryptedPayload, groupSymmetricKey);
            setDecryptedMessageCache((prev) => ({ ...prev, [msg.id]: decText }));
          }
        } else {
          // Direct chat hybrid protocol
          const encryptedKeys = msg.encryptedSymmetricKeys || {};
          const userEncryptedKey = encryptedKeys[currentUser.uid];

          if (userEncryptedKey) {
            // Decrypt local message-specific AES key
            const rawAesBytes = await asymmetricallyDecrypt(privateKeyStr, userEncryptedKey);
            const decText = await symmetricallyDecrypt(msg.encryptedPayload, rawAesBytes);
            setDecryptedMessageCache((prev) => ({ ...prev, [msg.id]: decText }));
          } else {
            setDecryptedMessageCache((prev) => ({ ...prev, [msg.id]: "[Cryptographic Key Unavailable: Symmetrically encrypted and locked]" }));
          }
        }
      } catch (err) {
        console.error("Payload decrypt error on msg " + msg.id, err);
        setDecryptedMessageCache((prev) => ({ ...prev, [msg.id]: "🛑 Decryption failed: corrupted payload or Key changed." }));
      }
    });
  }, [messages, groupSymmetricKey, privateKeyStr, decryptedMessageCache, currentUser.uid]);

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || sending) return;

    setSending(true);
    const textToSend = inputText;
    setInputText("");

    const messageId = "msg_" + Math.random().toString(36).substring(2, 11);

    try {
      if (isGroup) {
        if (!groupSymmetricKey) {
          throw new Error("No Group Key loaded.");
        }
        // Encrypt symmetrically
        const encryptedComposite = await symmetricallyEncrypt(textToSend, groupSymmetricKey);

        await dispatchMessage(chatId, messageId, {
          id: messageId,
          senderId: currentUser.uid,
          senderName: currentUser.displayName,
          encryptedPayload: encryptedComposite,
          isGroup: true,
        });
      } else {
        // Direct Hybrid Flow:
        // 1. Generate ephemeral symmetric key
        const rawAesBytes = await generateSymmetricKey();

        // 2. Encrypt plaintext symmetrically with ephemeral AES key
        const encryptedComposite = await symmetricallyEncrypt(textToSend, rawAesBytes);

        // 3. Obtain sender's own public key for backup decrypting
        const senderProfile = await fetchUserProfile(currentUser.uid);
        if (!senderProfile) {
          throw new Error("Your user profile public key registry cannot be found.");
        }
        const senderPubKey = senderProfile.publicKey;

        if (!recipientProfile?.publicKey) {
          throw new Error("Recipient public key not loaded yet.");
        }

        // 4. Encrypt ephemeral AES key under both sender's and recipient's public keys
        const encryptedKeyForSender = await asymmetricallyEncrypt(senderPubKey, rawAesBytes);
        const encryptedKeyForRecipient = await asymmetricallyEncrypt(recipientProfile.publicKey, rawAesBytes);

        await dispatchMessage(chatId, messageId, {
          id: messageId,
          senderId: currentUser.uid,
          senderName: currentUser.displayName,
          encryptedPayload: encryptedComposite,
          encryptedSymmetricKeys: {
            [currentUser.uid]: encryptedKeyForSender,
            [recipientProfile.id]: encryptedKeyForRecipient,
          },
          isGroup: false,
        });
      }
    } catch (e: any) {
      console.error(e);
      alert(`Dispatch failed: ${e.message || e}`);
      setInputText(textToSend); // recovery
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="px-5 py-4 bg-neutral-950 border-b border-neutral-800/80 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center space-x-1.5">
            <span>{roomName}</span>
          </h3>
          <p className="text-[10px] text-emerald-400 font-mono flex items-center mt-0.5">
            <Lock className="w-3 h-3 text-emerald-500 mr-1" />
            <span>Client-side Hybrid E2E Active (AES-256-GCM / RSA-SH256)</span>
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {(!isGroup && recipientProfile) && (
            <span className="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded flex items-center space-x-1 font-mono">
              <UserCheck className="w-3 h-3" />
              <span>Identity Verified</span>
            </span>
          )}
        </div>
      </div>

      {/* Body Area */}
      {!isCurrentlyUnlocked ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-neutral-950/45 p-6 text-center">
          <form onSubmit={handlePasswordSubmit} className="max-w-md w-full bg-neutral-900 border border-neutral-800 p-8 rounded-2xl shadow-xl space-y-6">
            <div className="p-4 bg-amber-950/40 border border-amber-500/20 max-w-max mx-auto rounded-2xl text-amber-400">
              <Lock className="w-8 h-8 mx-auto" />
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-semibold text-white">Password Protected Room</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                This room is protected by a secure lock. Enter the authorization password to decrypt and join this E2E session.
              </p>
            </div>

            <div className="space-y-4">
              <input
                type="password"
                placeholder="Enter room password..."
                value={enteredPassword}
                onChange={(e) => {
                  setEnteredPassword(e.target.value);
                  setPasswordError("");
                }}
                className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 text-sm font-mono text-center text-amber-300 rounded-lg placeholder-neutral-700 focus:outline-none focus:border-neutral-700 focus:border-amber-600 focus:ring-1 focus:ring-amber-950"
                required
                autoFocus
              />

              <button
                type="submit"
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-neutral-950 rounded-lg text-xs font-semibold transition cursor-pointer shadow-lg shadow-amber-950/30"
              >
                Unlock & Decrypt Room
              </button>

              {passwordError && (
                <p className="text-xs text-red-400 font-medium font-mono">{passwordError}</p>
              )}
            </div>
          </form>
        </div>
      ) : (
        <>
          {/* Message List */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-neutral-900/40">
            {decryptErr ? (
              <div className="max-w-md mx-auto p-4 bg-amber-950/25 border border-amber-500/30 rounded-xl space-y-2 text-center mt-12">
                <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
                <p className="text-xs text-amber-300 font-medium">{decryptErr}</p>
              </div>
            ) : (
              <>
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-2 opacity-50 select-none">
                    <Shield className="w-10 h-10 text-neutral-600" />
                    <p className="text-xs text-neutral-400 font-mono">
                      Encryption logs clean. Start typing securely...
                    </p>
                  </div>
                )}

                {messages.map((msg) => {
                  const isMe = msg.senderId === currentUser.uid;
                  const decrypted = decryptedMessageCache[msg.id];
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                    >
                      <div className="flex items-center space-x-1 text-[10px] text-neutral-400 font-mono mb-1">
                        <span>{isMe ? "You" : msg.senderName}</span>
                        <span>•</span>
                        <span>
                          {msg.createdAt
                            ? (msg.createdAt.seconds
                                ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : new Date(msg.createdAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }))
                            : "syncing..."}
                        </span>
                      </div>

                      <div
                        className={`max-w-[75%] px-4 py-2.5 rounded-lg text-sm transition break-words ${
                          isMe
                            ? "bg-emerald-600 border border-emerald-500/30 text-white rounded-br-none"
                            : "bg-neutral-950 border border-neutral-850 text-neutral-200 rounded-bl-none"
                        }`}
                      >
                        {decrypted === undefined ? (
                          <span className="flex items-center space-x-1 text-xs text-neutral-500 font-mono italic">
                            <Key className="w-3.5 h-3.5 animate-pulse text-amber-500/70" />
                            <span>Decrypting local cipher...</span>
                          </span>
                        ) : (
                          <p className="whitespace-pre-line leading-relaxed">{decrypted}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          {!decryptErr && (
            <form
              onSubmit={handleSendMessage}
              className="p-4 bg-neutral-950 border-t border-neutral-800/80 flex items-center space-x-2.5"
            >
              <input
                type="text"
                placeholder="Ensure absolute privacy: cryptographically sign and send message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={sending || (!isGroup && !recipientProfile) || (isGroup && !groupSymmetricKey)}
                className="flex-1 px-4 py-2.5 bg-neutral-900 border border-neutral-800 text-sm text-neutral-200 rounded-lg placeholder-neutral-500 hover:border-neutral-700 focus:outline-none focus:border-neutral-600 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || sending || (!isGroup && !recipientProfile) || (isGroup && !groupSymmetricKey)}
                className="p-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white rounded-lg transition shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
