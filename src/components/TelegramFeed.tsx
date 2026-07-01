import React, { useState, useEffect } from "react";
import {
  subscribeTelegramChannels,
  saveTelegramChannelConfig,
  deleteTelegramChannelConfig,
} from "../lib/dbBridge";
import { TelegramChannelConfig, TelegramPostItem } from "../types";
import {
  Globe,
  RefreshCw,
  AlertCircle,
  MessageSquare,
  ExternalLink,
  Calendar,
  Trash2,
  Plus,
} from "lucide-react";

interface TelegramFeedProps {
  userIsAdmin?: boolean;
}

export default function TelegramFeed({ userIsAdmin = false }: TelegramFeedProps) {
  const [channels, setChannels] = useState<TelegramChannelConfig[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<TelegramChannelConfig | null>(null);
  const [posts, setPosts] = useState<TelegramPostItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [newChannelHandle, setNewChannelHandle] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [addingChannel, setAddingChannel] = useState(false);
  const [managementMsg, setManagementMsg] = useState("");

  useEffect(() => {
    // Listen for registered channels via bridge
    const unsubscribe = subscribeTelegramChannels((list) => {
      setChannels(list);
      
      // Auto-select first channel if none is active
      if (list.length > 0 && !selectedChannel) {
        setSelectedChannel(list[0]);
      }
    });

    return () => unsubscribe();
  }, [selectedChannel]);

  // Fetch posts from express proxy when channel selection shifts or user triggers reload
  useEffect(() => {
    if (selectedChannel) {
      loadFeeds(selectedChannel.id);
    }
  }, [selectedChannel]);

  const loadFeeds = async (channelId: string) => {
    setLoading(true);
    setErrorMsg("");
    try {
      const response = await fetch(`/api/telegram/fetch?channel=${channelId}`);
      if (!response.ok) {
        throw new Error(`Failed to scrape feed (HTTP status: ${response.status})`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setPosts(data.posts || []);
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during scraper pipeline.");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setManagementMsg("");
    const handle = newChannelHandle.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "");
    const name = newChannelName.trim() || `@${handle}`;

    if (!handle) {
      setManagementMsg("Invalid Telegram handle.");
      return;
    }

    setAddingChannel(true);
    try {
      await saveTelegramChannelConfig(
        handle,
        name,
        `Connected public Telegram feed from t.me/s/${handle}`
      );
      setNewChannelHandle("");
      setNewChannelName("");
      setManagementMsg(`Registered channel: @${handle}`);
    } catch (err) {
      setManagementMsg("Failed to register Telegram channel.");
    } finally {
      setAddingChannel(false);
    }
  };

  const handleDeleteChannel = async (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to stop monitoring @${channelId}?`)) return;
    
    try {
      await deleteTelegramChannelConfig(channelId);
      if (selectedChannel?.id === channelId) {
        setSelectedChannel(null);
        setPosts([]);
      }
    } catch (err) {
      alert("Failed to delete channel.");
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      {/* Channels Sidebar Selection */}
      <div className="md:col-span-1 space-y-4">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center space-x-1.5">
            <Globe className="w-3.5 h-3.5" />
            <span>Monitored Feeds</span>
          </h3>

          <div className="space-y-1.5">
            {channels.length === 0 ? (
              <p className="text-xs text-neutral-500 py-3">
                No Telegram channels registered by administrator yet.
              </p>
            ) : (
              channels.map((chan) => (
                <div
                  key={chan.id}
                  onClick={() => setSelectedChannel(chan)}
                  className={`w-full group text-left px-3 py-2 rounded-lg text-xs font-medium transition flex items-center justify-between cursor-pointer border ${
                    selectedChannel?.id === chan.id
                      ? "bg-emerald-950/60 border-emerald-500/30 text-emerald-400"
                      : "bg-neutral-950 border-transparent text-neutral-400 hover:text-white"
                  }`}
                >
                  <div className="flex flex-col min-w-0 pr-1 select-none">
                    <span className="truncate font-semibold">{chan.displayName}</span>
                    <span className="text-[10px] text-neutral-500 font-mono mt-0.5">@{chan.id}</span>
                  </div>
                  {userIsAdmin && (
                    <button
                      onClick={(e) => handleDeleteChannel(chan.id, e)}
                      className="p-1 text-neutral-500 hover:text-red-400 rounded transition hover:bg-neutral-900 cursor-pointer shrink-0"
                      title="Remove channel"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {userIsAdmin && (
            <div className="border-t border-neutral-800/80 pt-4 mt-2 space-y-3">
              <h4 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Plus className="w-3 h-3 text-emerald-500" />
                <span>Register New Feed</span>
              </h4>
              <form onSubmit={handleAddChannel} className="space-y-2">
                <input
                  type="text"
                  placeholder="Handle (e.g. durov)"
                  value={newChannelHandle}
                  onChange={(e) => setNewChannelHandle(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 text-xs text-neutral-200 rounded focus:outline-none focus:border-neutral-700 font-sans"
                  required
                />
                <input
                  type="text"
                  placeholder="Feed Display Name"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 text-xs text-neutral-200 rounded focus:outline-none focus:border-neutral-700 font-sans"
                />
                <button
                  type="submit"
                  disabled={addingChannel}
                  className="w-full py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-neutral-800 text-white rounded text-xs font-semibold font-sans transition cursor-pointer"
                >
                  {addingChannel ? "Registering..." : "Add Feed"}
                </button>
                {managementMsg && (
                  <p className="text-[10px] text-amber-500 italic mt-1 font-sans">{managementMsg}</p>
                )}
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Feed Panel */}
      <div className="md:col-span-3 space-y-4">
        {selectedChannel ? (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 bg-neutral-950 border-b border-neutral-800/80 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Feed Preview: {selectedChannel.displayName}
                </h3>
                <p className="text-[10px] text-neutral-500 mt-0.5">
                  Decentralized parser mapping t.me web preview records safely
                </p>
              </div>
              <button
                onClick={() => loadFeeds(selectedChannel.id)}
                disabled={loading}
                className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white disabled:bg-neutral-950 disabled:text-neutral-700 rounded-md transition cursor-pointer"
                title="Force refresh scraper"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Feed List */}
            <div className="p-5 space-y-6 max-h-[550px] overflow-y-auto min-h-[300px]">
              {loading && !posts.length ? (
                <div className="h-64 flex flex-col items-center justify-center text-center space-y-2 text-neutral-550 italic text-xs">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
                  <span>Contacting Telegram public nodes and extracting feed...</span>
                </div>
              ) : errorMsg ? (
                <div className="p-4 bg-red-950/30 border border-red-500/20 text-red-400 rounded-lg flex items-start space-x-3 text-xs leading-relaxed max-w-lg mx-auto mt-12">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              ) : posts.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center opacity-50 select-none text-xs text-neutral-400">
                  <MessageSquare className="w-8 h-8 mb-1" />
                  <span>No recent posts detected or channel contains mature/private content.</span>
                </div>
              ) : (
                posts.map((post) => (
                  <div
                    key={post.id}
                    className="p-4 bg-neutral-950 border border-neutral-850 hover:border-neutral-800 rounded-lg space-y-3.5 transition"
                  >
                    {/* Post metadata */}
                    <div className="flex items-center justify-between text-[11px] text-neutral-450 font-mono">
                      <span className="bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800/80 text-[10px]">
                        Post ID: {post.postId}
                      </span>
                      <span className="flex items-center space-x-1">
                        <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                        <span>{new Date(post.date).toLocaleString()}</span>
                      </span>
                    </div>

                    {/* Media wrap */}
                    {post.mediaUrl && (
                      <div className="relative rounded overflow-hidden border border-neutral-850 max-h-80 bg-neutral-900 flex justify-center">
                        <img
                          src={post.mediaUrl}
                          alt="Telegram post media attachment"
                          className="object-contain max-h-80"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}

                    {/* Message Text */}
                    <p className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap">
                      {post.text}
                    </p>

                    {/* External Link */}
                    <div className="flex justify-end pt-1">
                      <a
                        href={`https://t.me/${selectedChannel.id}/${post.postId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 transition flex items-center space-x-0.5 font-mono"
                      >
                        <span>Open on Telegram</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="h-64 bg-neutral-900 border border-neutral-800 rounded-xl flex items-center justify-center text-center text-xs text-neutral-500 italic">
            Select a public Telegram channel from the sidebar to inspect posts.
          </div>
        )}
      </div>
    </div>
  );
}
