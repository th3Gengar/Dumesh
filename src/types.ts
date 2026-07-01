export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  publicKey: string; // Asymmetric public key (JWK as string)
  createdAt: any;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  password?: string; // Optional password to enter/unlock the group room
  createdBy: string;
  createdAt: any;
}

export interface GroupMember {
  userId: string;
  email: string;
  displayName: string;
  encryptedGroupKey: string; // Group's AES key encrypted with this user's RSA public key
  createdAt: any;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  encryptedPayload: string; // Symmetrically encrypted JSON state { text, timestamp }
  encryptedSymmetricKeys?: { [userId: string]: string }; // For direct 1-to-1 chats: encrypted message AES key for each participant
  isGroup: boolean;
  createdAt: any;
}

export interface TelegramChannelConfig {
  id: string; // handle (e.g. "durov")
  displayName: string;
  description: string;
  createdAt: any;
}

export interface TelegramPostItem {
  id: string;
  postId: string;
  text: string;
  date: string;
  mediaUrl?: string;
  fetchedAt?: string;
}

export interface AllowedEmail {
  id: string; // same as email
  email: string;
  displayName: string;
  assignedGroups: string[]; // List of Group IDs the user is assigned to
  createdAt: any;
}
