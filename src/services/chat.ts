import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp
} from 'firebase/firestore';
import { db, sendNotification } from '../lib/firebase';
import { sendPushNotification } from '../lib/push';
import { ChatAttachment, ChatReaction } from '../types';

/**
 * Returns a sorted direct chat ID to ensure uniqueness per user pair.
 */
export function getDirectChatId(uid1: string, uid2: string): string {
  const sorted = [uid1, uid2].sort();
  return `direct_${sorted[0]}_${sorted[1]}`;
}

/**
 * Retrieves an existing 1-on-1 chat or creates it if it doesn't exist.
 */
export async function getOrCreateDirectChat(
  currentUser: { uid: string; displayName: string },
  targetUser: { uid: string; displayName: string }
): Promise<string> {
  const roomId = getDirectChatId(currentUser.uid, targetUser.uid);
  const roomRef = doc(db, 'chatRooms', roomId);
  const roomDoc = await getDoc(roomRef);

  if (roomDoc.exists()) {
    return roomId;
  }

  // Check if a direct room with these memberIds already exists under another ID
  try {
    const q = query(
      collection(db, 'chatRooms'),
      where('type', '==', 'direct'),
      where('memberIds', 'array-contains', currentUser.uid)
    );
    const snap = await getDocs(q);
    const existing = snap.docs.find((d) => {
      const data = d.data();
      return Array.isArray(data.memberIds) && data.memberIds.includes(targetUser.uid);
    });
    if (existing) {
      return existing.id;
    }
  } catch (err) {
    console.error('Error checking existing direct chat:', err);
  }

  await setDoc(roomRef, {
    type: 'direct',
    memberIds: [currentUser.uid, targetUser.uid],
    createdById: currentUser.uid,
    createdByName: currentUser.displayName,
    createdAt: serverTimestamp(),
  });

  return roomId;
}

/**
 * Creates a new group chat room and logs a system message.
 */
export async function createGroupChat(
  groupName: string,
  memberUids: string[],
  currentUser: { uid: string; displayName: string }
): Promise<string> {
  const allMembers = Array.from(new Set([currentUser.uid, ...memberUids]));
  
  const roomRef = await addDoc(collection(db, 'chatRooms'), {
    type: 'group',
    name: groupName,
    memberIds: allMembers,
    createdById: currentUser.uid,
    createdByName: currentUser.displayName,
    createdAt: serverTimestamp(),
  });

  // Post system genesis message
  await addDoc(collection(db, 'chatRooms', roomRef.id, 'messages'), {
    roomId: roomRef.id,
    text: `${currentUser.displayName} created group "${groupName}"`,
    senderId: currentUser.uid,
    senderName: 'System',
    timestamp: serverTimestamp(),
    type: 'system',
  });

  // Notify members added to group
  for (const memberId of memberUids) {
    if (memberId === currentUser.uid) continue;
    void sendNotification({
      userId: memberId,
      title: 'Added to group',
      message: `${currentUser.displayName} added you to group "${groupName}"`,
      type: 'info',
      targetId: roomRef.id,
      link: `/messages/${roomRef.id}`,
    });
  }

  return roomRef.id;
}

/**
 * Creates an announcement room — everyone in it reads, only Full-timers post.
 * firestore.rules only lets an admin create one, so this is a staff-only call.
 */
export async function createAnnouncementRoom(
  name: string,
  memberUids: string[],
  currentUser: { uid: string; displayName: string },
  audiencePreset?: 'everyone' | 'custom',
  initialPost?: { text: string; attachments?: ChatAttachment[]; pinned?: boolean }
): Promise<string> {
  const allMembers = Array.from(new Set([currentUser.uid, ...memberUids]));

  // The genesis/initial messages below post with raw addDoc, which — unlike
  // sendMessage — never writes the room preview. Set lastMessage here so the
  // rail shows the announcement instead of "No messages yet" (#836).
  const genesisText = `${currentUser.displayName} started announcements for "${name}"`;
  const hasPostText = !!initialPost?.text.trim();
  const hasPostFiles = !!initialPost?.attachments?.length;

  const roomData: Record<string, any> = {
    type: 'announcement',
    name,
    memberIds: allMembers,
    createdById: currentUser.uid,
    createdByName: currentUser.displayName,
    createdAt: serverTimestamp(),
    lastMessage: {
      text: hasPostText
        ? initialPost!.text.trim()
        : hasPostFiles
          ? `Shared ${initialPost!.attachments![0].type}`
          : genesisText,
      senderId: currentUser.uid,
      senderName: hasPostText || hasPostFiles ? currentUser.displayName : 'System',
      timestamp: serverTimestamp(),
    },
  };

  if (audiencePreset) {
    roomData.audiencePreset = audiencePreset;
  }

  const roomRef = await addDoc(collection(db, 'chatRooms'), roomData);

  // Post system genesis message. senderId must be the acting uid, not the
  // 'system' sentinel createGroupChat uses — the messages create rule checks
  // `senderId == request.auth.uid` and silently drops the write otherwise.
  await addDoc(collection(db, 'chatRooms', roomRef.id, 'messages'), {
    roomId: roomRef.id,
    text: genesisText,
    senderId: currentUser.uid,
    senderName: 'System',
    timestamp: serverTimestamp(),
    type: 'system',
  });

  // If an initial announcement post was written, send it immediately
  if (initialPost && (initialPost.text.trim() || (initialPost.attachments && initialPost.attachments.length > 0))) {
    await addDoc(collection(db, 'chatRooms', roomRef.id, 'messages'), {
      roomId: roomRef.id,
      text: initialPost.text.trim(),
      senderId: currentUser.uid,
      senderName: currentUser.displayName,
      senderPhoto: '',
      timestamp: serverTimestamp(),
      type: 'text',
      attachments: initialPost.attachments || [],
      parentId: null,
      pinned: !!initialPost.pinned,
    });
  }

  // Notify members added to announcement channel
  for (const memberId of memberUids) {
    if (memberId === currentUser.uid) continue;
    void sendNotification({
      userId: memberId,
      title: 'New announcement channel',
      message: `${currentUser.displayName} started announcements for "${name}"`,
      type: 'info',
      targetId: roomRef.id,
      link: `/messages/${roomRef.id}`,
    });
    void sendPushNotification({
      userId: memberId,
      title: 'New announcement channel',
      body: `${currentUser.displayName} started announcements for "${name}"`,
      data: { targetId: roomRef.id, link: `/messages/${roomRef.id}` },
    });
  }

  return roomRef.id;
}

/**
 * Sends a message and updates the room's last message preview.
 */
export async function sendMessage(
  roomId: string,
  text: string,
  sender: { uid: string; displayName: string; photoURL?: string },
  attachments?: ChatAttachment[],
  memberIds?: string[],
  parentId?: string | null,
  roomType?: 'direct' | 'group' | 'announcement',
  roomName?: string
): Promise<void> {
  const messagesRef = collection(db, 'chatRooms', roomId, 'messages');
  
  const msgText = text.trim();
  if (!msgText && (!attachments || attachments.length === 0)) {
    return;
  }

  // Create message doc
  await addDoc(messagesRef, {
    roomId,
    text: msgText,
    senderId: sender.uid,
    senderName: sender.displayName,
    senderPhoto: sender.photoURL || '',
    timestamp: serverTimestamp(),
    type: 'text',
    attachments: attachments || [],
    parentId: parentId ?? null,
  });

  // Update last message preview in chatRoom
  const basePreview = msgText || (attachments && attachments.length > 0 
    ? `Shared ${attachments[0].type}` 
    : 'New message');
  const previewText = parentId ? `in a thread: ${basePreview}` : basePreview;

  await updateDoc(doc(db, 'chatRooms', roomId), {
    lastMessage: {
      text: previewText,
      senderId: sender.uid,
      senderName: sender.displayName,
      timestamp: serverTimestamp(),
    },
  });

  // Notify recipient(s) in room
  let recipients = memberIds;
  let audiencePreset: string | undefined;
  if (!recipients || recipients.length === 0) {
    try {
      const roomDoc = await getDoc(doc(db, 'chatRooms', roomId));
      if (roomDoc.exists()) {
        const data = roomDoc.data();
        recipients = Array.isArray(data?.memberIds) ? data.memberIds : [];
        audiencePreset = data?.audiencePreset;
      }
    } catch (e) {
      console.error('Error fetching room members for notification:', e);
    }
  }

  // If audience preset is 'everyone', reconcile membership before notifying
  if (audiencePreset === 'everyone') {
    try {
      const usersSnap = await getDocs(query(collection(db, 'users'), where('approved', '==', true)));
      const activeUids = usersSnap.docs
        .filter((d) => {
          const u = d.data();
          const email = (u.email || '').toLowerCase();
          const name = (u.displayName || '').toLowerCase();
          return !email.startsWith('cisa-') && !name.startsWith('cisa-');
        })
        .map((d) => d.id);
      
      const newUids = activeUids.filter((id) => !recipients!.includes(id));
      if (newUids.length > 0) {
        await updateDoc(doc(db, 'chatRooms', roomId), {
          memberIds: arrayUnion(...newUids),
        });
        recipients = Array.from(new Set([...recipients!, ...newUids]));
      }
    } catch (e) {
      console.error('Error reconciling audience preset membership:', e);
    }
  }

  const isAnnounce = roomType === 'announcement';

  if (isAnnounce && parentId) {
    // Thread reply in an announcement room: notify post author & thread participants only
    const threadRecipients = new Set<string>();
    try {
      // Find thread participants
      const threadRepliesSnap = await getDocs(
        query(collection(db, 'chatRooms', roomId, 'messages'), where('parentId', '==', parentId))
      );
      threadRepliesSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.senderId) threadRecipients.add(data.senderId);
      });

      // Find author of parent message
      const parentSnap = await getDoc(doc(db, 'chatRooms', roomId, 'messages', parentId));
      if (parentSnap.exists()) {
        const parentData = parentSnap.data();
        if (parentData?.senderId) threadRecipients.add(parentData.senderId);
      }
    } catch (e) {
      console.error('Error fetching thread participants for notification:', e);
    }

    for (const memberId of threadRecipients) {
      if (memberId === sender.uid) continue;
      const title = roomName || 'Announcement';
      const body = `${sender.displayName}: ${previewText}`;
      void sendNotification({
        userId: memberId,
        title,
        message: body,
        type: 'info',
        targetId: roomId,
        link: `/messages/${roomId}`,
      });
      void sendPushNotification({
        userId: memberId,
        title,
        body,
        data: { targetId: roomId, link: `/messages/${roomId}` },
      });
    }
    return;
  }

  if (recipients && Array.isArray(recipients)) {
    for (const memberId of recipients) {
      if (memberId === sender.uid) continue;

      const title = isAnnounce ? (roomName || 'Announcement') : 'New message';
      const notificationBody = isAnnounce
        ? `${sender.displayName} posted an announcement: ${previewText}`
        : `${sender.displayName}: ${previewText}`;

      void sendNotification({
        userId: memberId,
        title,
        message: notificationBody,
        type: 'info',
        targetId: roomId,
        link: `/messages/${roomId}`,
      });
      // Same trigger as the in-app bell, but as an OS-level push to the
      // recipient's phone (#270).
      void sendPushNotification({
        userId: memberId,
        title,
        body: notificationBody,
        data: { targetId: roomId, link: `/messages/${roomId}` },
      });
    }
  }
}

/**
 * Toggle an acknowledgement ("Got it") on an announcement post.
 * firestore.rules only lets a room member update their own entry.
 */
export async function acknowledgeAnnouncement(
  roomId: string,
  messageId: string,
  uid: string,
  current: string[] = []
): Promise<void> {
  const has = current.includes(uid);
  const acknowledged = has ? current.filter((id) => id !== uid) : [...current, uid];
  await updateDoc(doc(db, 'chatRooms', roomId, 'messages', messageId), { acknowledged });
}

/**
 * Record a passive read receipt for an announcement post.
 * Fired debounced/non-blocking when post enters view; errors are swallowed.
 */
export async function markAnnouncementRead(
  roomId: string,
  messageId: string,
  uid: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'chatRooms', roomId, 'messages', messageId), {
      readBy: arrayUnion(uid),
    });
  } catch (err) {
    // A lost read receipt is not worth interrupting the reader
    console.debug('Failed to record announcement read receipt:', err);
  }
}

/**
 * Invites members to an existing group chat room and logs a system message.
 */
export async function inviteToGroup(
  roomId: string,
  newUserUids: string[],
  newUserNames: string[],
  inviterName: string
): Promise<void> {
  const roomRef = doc(db, 'chatRooms', roomId);
  await updateDoc(roomRef, {
    memberIds: arrayUnion(...newUserUids),
  });

  // Post system message
  const namesStr = newUserNames.join(', ');
  await addDoc(collection(db, 'chatRooms', roomId, 'messages'), {
    roomId,
    text: `${inviterName} added ${namesStr} to the group`,
    senderId: 'system',
    senderName: 'System',
    timestamp: serverTimestamp(),
    type: 'system',
  });

  // Notify invited members
  for (const memberId of newUserUids) {
    void sendNotification({
      userId: memberId,
      title: 'Added to group',
      message: `${inviterName} added you to the group`,
      type: 'info',
      targetId: roomId,
      link: `/messages/${roomId}`,
    });
  }
}

/**
 * Leaves a group chat room and logs a system message.
 */
export async function leaveGroup(
  roomId: string,
  user: { uid: string; displayName: string }
): Promise<void> {
  const roomRef = doc(db, 'chatRooms', roomId);
  await updateDoc(roomRef, {
    memberIds: arrayRemove(user.uid),
  });

  // Post system message
  await addDoc(collection(db, 'chatRooms', roomId, 'messages'), {
    roomId,
    text: `${user.displayName} left the group`,
    senderId: 'system',
    senderName: 'System',
    timestamp: serverTimestamp(),
    type: 'system',
  });
}

/**
 * Toggle a reaction on a message. `by` is the reacting user's uid; the emoji
 * flips on or off for that user only. firestore.rules only lets a room member
 * write the `reactions` field, so this is a single targeted update.
 */
export async function reactToMessage(
  roomId: string,
  messageId: string,
  by: string,
  emoji: string,
  current: ChatReaction[]
): Promise<void> {
  const has = current.some((r) => r.by === by && r.emoji === emoji);
  const reactions = has
    ? current.filter((r) => !(r.by === by && r.emoji === emoji))
    : [...current, { by, emoji }];
  await updateDoc(doc(db, 'chatRooms', roomId, 'messages', messageId), { reactions });
}

/**
 * Pin or unpin a message. Anyone in the room can do it — the pinned strip is a
 * conversation-level convenience, not a permission boundary.
 */
export async function togglePinMessage(roomId: string, messageId: string, pinned: boolean): Promise<void> {
  await updateDoc(doc(db, 'chatRooms', roomId, 'messages', messageId), { pinned });
}

/**
 * Take a message back for everyone: leaves a `deleted` tombstone so the thread
 * shows "Message removed" instead of the text. Only the author or a Full-timer
 * may call this — firestore.rules enforces it server-side too, and it splits
 * this tombstone write from reaction/pin toggles: only `deleted` may change.
 */
export async function removeMessageForEveryone(roomId: string, messageId: string, by: string): Promise<void> {
  await updateDoc(doc(db, 'chatRooms', roomId, 'messages', messageId), {
    deleted: { by, at: serverTimestamp() },
  });
}

/**
 * Permanently delete a conversation room for everyone. Only the room's creator
 * or an Admin / Full-timer may call this — firestore.rules enforces it server-side.
 */
export async function deleteChatRoom(roomId: string): Promise<void> {
  await deleteDoc(doc(db, 'chatRooms', roomId));
}

/**
 * Check whether the viewer can delete a room for everyone — its creator or an Admin.
 */
export function canRemoveConvForEveryone(
  room: { createdById?: string } | null | undefined,
  currentUid: string | null | undefined,
  isAdmin: boolean
): boolean {
  if (!room) return false;
  return isAdmin || (!!currentUid && room.createdById === currentUid);
}

// ── Slack-shaped threads (#563) ─────────────────────────────────────────────

/** Top-level messages in a conversation (replies filtered out). */
export function convTopLevel(messages: import('../types').ChatMessage[]): import('../types').ChatMessage[] {
  return messages.filter((m) => !m.parentId);
}

/** Replies belonging to a parent message, chronological. */
export function convReplies(messages: import('../types').ChatMessage[], parentId: string): import('../types').ChatMessage[] {
  return messages.filter((m) => m.parentId === parentId);
}

/** Total reply count for a message. */
export function convReplyCount(messages: import('../types').ChatMessage[], parentId: string): number {
  return convReplies(messages, parentId).length;
}

/** Unique uids of users who replied to a message, in order of first reply. */
export function convRepliers(messages: import('../types').ChatMessage[], parentId: string): string[] {
  const seen = new Set<string>();
  const repliers: string[] = [];
  for (const r of convReplies(messages, parentId)) {
    if (r.senderId && !seen.has(r.senderId)) {
      seen.add(r.senderId);
      repliers.push(r.senderId);
    }
  }
  return repliers;
}

/** The latest reply to a message, if any. */
export function convLastReply(messages: import('../types').ChatMessage[], parentId: string): import('../types').ChatMessage | undefined {
  const replies = convReplies(messages, parentId);
  return replies[replies.length - 1];
}



