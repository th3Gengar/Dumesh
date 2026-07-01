import React, { useState, useEffect } from "react";
import { generateAsymmetricKeyPair } from "../lib/crypto";
import { fetchUserProfile, saveUserProfile } from "../lib/dbBridge";
import { Key, Shield, Download, Upload, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";

interface KeyManagerProps {
  userId: string;
  userEmail: string;
  userDisplayName: string;
  onKeysReady: (privateKey: string, forceRedirect?: boolean) => void;
}

export default function KeyManager({
  userId,
  userEmail,
  userDisplayName,
  onKeysReady,
}: KeyManagerProps) {
  const [hasServerKey, setHasServerKey] = useState<boolean | null>(null);
  const [localPrivateKey, setLocalPrivateKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");
  const [importKeyInput, setImportKeyInput] = useState<string>("");
  const [showImport, setShowImport] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);

  const localKeyName = `e2e_private_key_${userId}`;

  useEffect(() => {
    checkKeys();
  }, [userId]);

  const checkKeys = async () => {
    try {
      // 1. Check local private key
      const localPriv = localStorage.getItem(localKeyName);
      setLocalPrivateKey(localPriv);

      // 2. Check public key via bridge
      const userProfile = await fetchUserProfile(userId);

      if (userProfile && userProfile.publicKey) {
        setHasServerKey(true);
        if (localPriv) {
          onKeysReady(localPriv, false); // Propagate keys up silently without triggering redirect
        } else {
          setStatus("Keys exist on server, but your local private key was not found. Please import it below, or generate new ones (caution).");
        }
      } else {
        setHasServerKey(false);
        if (localPriv) {
          setStatus("A local key pair exists, but your public key is not registered in the secure database.");
        } else {
          setStatus("First-time setup: You must generate your end-to-end cryptographic key pair.");
        }
      }
    } catch (e) {
      setErrorMsg("Failed to synchronize keys with secure database.");
    }
  };

  const handleGenerateKeys = async () => {
    setGenerating(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      setStatus("Generating secure RSA-2048 high-entropy key pairs on your device...");
      const { publicKeyJwk, privateKeyJwk } = await generateAsymmetricKeyPair();

      // Store private key locally
      localStorage.setItem(localKeyName, privateKeyJwk);
      setLocalPrivateKey(privateKeyJwk);

      // Publish public key via bridge
      await saveUserProfile(userId, userEmail, userDisplayName, publicKeyJwk);

      setHasServerKey(true);
      setSuccessMsg("Keys successfully generated and registered. Your device is now fully E2E encrypted!");
      onKeysReady(privateKeyJwk, true); // Redirect to chats after generation
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Generation failed: ${err.message || err}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegisterPublicKey = async () => {
    if (!localPrivateKey) return;
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const parsedPrivate = JSON.parse(localPrivateKey);
      const publicJwk = {
        kty: parsedPrivate.kty,
        n: parsedPrivate.n,
        e: parsedPrivate.e,
        alg: parsedPrivate.alg || "RSA-OAEP",
        key_ops: ["encrypt"],
        ext: true
      };
      
      await saveUserProfile(userId, userEmail, userDisplayName, JSON.stringify(publicJwk));
      setHasServerKey(true);
      setSuccessMsg("Your existing Public Key has been registered with E2E servers successfully!");
      onKeysReady(localPrivateKey, true); // Redirect to chats
    } catch (e: any) {
      setErrorMsg(`Registration failed: ${e.message || e}`);
    }
  };

  const handleExportKey = () => {
    if (!localPrivateKey) return;
    const blob = new Blob([localPrivateKey], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `messenger_e2e_private_key_${userDisplayName.replace(/\s+/g, "_")}.key`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setSuccessMsg("Private key exported successfully. Save this file in a secure, offline location!");
  };

  const handleImportKey = async () => {
    setErrorMsg("");
    setSuccessMsg("");
    if (!importKeyInput.trim()) {
      setErrorMsg("Please paste your valid private JWK key string.");
      return;
    }

    try {
      // Validate string is JSON and has RSA key configuration
      const parsed = JSON.parse(importKeyInput.trim());
      if (parsed.kty !== "RSA") {
        throw new Error("Invalid key type. Private key must be a valid RSA key.");
      }

      localStorage.setItem(localKeyName, JSON.stringify(parsed));
      setLocalPrivateKey(JSON.stringify(parsed));
      setSuccessMsg("Private key imported successfully!");
      setShowImport(false);
      onKeysReady(JSON.stringify(parsed), true); // Redirect to chats after import
    } catch (e: any) {
      setErrorMsg(`Import failed: ${e.message || "Invalid JSON or key format"}`);
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 max-w-xl mx-auto space-y-6">
      <div className="flex items-center space-x-3">
        <div className="p-3 bg-emerald-950/50 border border-emerald-500/30 rounded-xl text-emerald-400">
          <Shield className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">E2E Cryptographic Vault</h2>
          <p className="text-xs text-neutral-400">Client-Side encryption & key management</p>
        </div>
      </div>

      {status && (
        <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-lg flex items-start space-x-3 text-sm text-neutral-300">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <span>{status}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-lg text-xs text-red-400">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-lg text-xs text-emerald-400 flex items-center space-x-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="space-y-4">
        {(!localPrivateKey || !hasServerKey) ? (
          <div className="space-y-3">
            <button
              onClick={handleGenerateKeys}
              disabled={generating}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-lg font-medium transition cursor-pointer"
            >
              {generating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Key className="w-4 h-4" />
              )}
              <span>{generating ? "Generating Cryptography..." : "Generate New E2E Keys"}</span>
            </button>

            {localPrivateKey && hasServerKey === false && (
              <button
                onClick={handleRegisterPublicKey}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-neutral-950 rounded-lg font-medium transition cursor-pointer"
              >
                <Shield className="w-4 h-4" />
                <span>Register Existing Public Key with Server</span>
              </button>
            )}
          </div>
        ) : (
          <div className="bg-neutral-950/60 p-4 border border-neutral-800/80 rounded-lg flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-white">Keys Activated & Localized</p>
                <p className="text-[10px] text-neutral-500 font-mono">
                  Type: RSA-OAEP / 2048-bit / Local-Vault
                </p>
              </div>
            </div>
            <button
               onClick={handleExportKey}
               className="flex items-center space-x-1 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-md text-xs transition border border-neutral-700/60 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export/Backup Private Key</span>
            </button>
          </div>
        )}

        <div className="border-t border-neutral-800 pt-4">
          <button
            onClick={() => setShowImport(!showImport)}
            className="text-xs text-neutral-400 hover:text-neutral-200 transition underline flex items-center space-x-1"
          >
            <Upload className="w-3 h-3" />
            <span>Need to import a backup private key?</span>
          </button>

          {showImport && (
            <div className="mt-3 space-y-2">
              <textarea
                placeholder="Paste your exported Private Key JSON string here..."
                value={importKeyInput}
                onChange={(e) => setImportKeyInput(e.target.value)}
                rows={4}
                className="w-full p-2.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs font-mono text-neutral-300 focus:outline-none focus:border-neutral-700"
              />
              <button
                onClick={handleImportKey}
                className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-md text-xs font-medium transition cursor-pointer"
              >
                Assemble and Import Private Key
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
