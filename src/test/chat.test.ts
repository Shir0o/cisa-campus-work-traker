import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as firestore from 'firebase/firestore';

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn().mockResolvedValue({ docs: [] });
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockAddDoc = vi.fn().mockResolvedValue({ id: 'new-doc-id' });
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/firestore', () => ({
  getDoc: (...args: any[]) => mockGetDoc(...args),
  getDocs: (...args: any[]) => mockGetDocs(...args),
  setDoc: (...args: any[]) => mockSetDoc(...args),
  addDoc: (...args: any[]) => mockAddDoc(...args),
  updateDoc: (...args: any[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: any[]) => mockDeleteDoc(...args),
  query: vi.fn((...args: any[]) => `query:${args.join('/')}`),
  where: vi.fn((field: string, op: string, val: any) => `where:${field}_${op}_${val}`),
  collection: vi.fn((_db: any, ...paths: string[]) => `col:${paths.join('/')}`),
  doc: vi.fn((_db: any, ...paths: string[]) => `doc:${paths.join('/')}`),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  arrayUnion: vi.fn((...args: any[]) => ({ type: 'arrayUnion', args })),
  arrayRemove: vi.fn((...args: any[]) => ({ type: 'arrayRemove', args })),
}));

const mockSendNotification = vi.fn().mockResolvedValue(undefined);

vi.mock('../lib/firebase', () => ({
  db: 'mock-db',
  sendNotification: (...args: any[]) => mockSendNotification(...args),
}));

const mockSendPushNotification = vi.fn().mockResolvedValue(undefined);

vi.mock('../lib/push', () => ({
  sendPushNotification: (...args: any[]) => mockSendPushNotification(...args),
}));

import {
  getDirectChatId,
  getOrCreateDirectChat,
  createGroupChat,
  createAnnouncementRoom,
  sendMessage,
  inviteToGroup,
  leaveGroup,
  reactToMessage,
  togglePinMessage,
  removeMessageForEveryone,
  deleteChatRoom,
  acknowledgeAnnouncement,
  markAnnouncementRead,
  canRemoveConvForEveryone
} from '../services/chat';

describe('chat.ts services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDirectChatId', () => {
    it('sorts UIDs alphabetically and outputs direct ID', () => {
      expect(getDirectChatId('uidB', 'uidA')).toBe('direct_uidA_uidB');
      expect(getDirectChatId('uid123', 'uid456')).toBe('direct_uid123_uid456');
    });
  });

  describe('getOrCreateDirectChat', () => {
    it('returns roomId immediately if room document exists', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true
      });

      const roomId = await getOrCreateDirectChat(
        { uid: 'u1', displayName: 'User One' },
        { uid: 'u2', displayName: 'User Two' }
      );

      expect(roomId).toBe('direct_u1_u2');
      expect(mockGetDoc).toHaveBeenCalled();
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('creates room document if it does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => false
      });

      const roomId = await getOrCreateDirectChat(
        { uid: 'u1', displayName: 'User One' },
        { uid: 'u2', displayName: 'User Two' }
      );

      expect(roomId).toBe('direct_u1_u2');
      expect(mockGetDoc).toHaveBeenCalled();
      expect(mockSetDoc).toHaveBeenCalledWith('doc:chatRooms/direct_u1_u2', {
        type: 'direct',
        memberIds: ['u1', 'u2'],
        createdById: 'u1',
        createdByName: 'User One',
        createdAt: 'SERVER_TS',
      });
    });

    it('reuses existing direct room document if one already exists under another ID', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => false
      });
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'legacy-room-id',
            data: () => ({ type: 'direct', memberIds: ['u1', 'u2'] })
          }
        ]
      });

      const roomId = await getOrCreateDirectChat(
        { uid: 'u1', displayName: 'User One' },
        { uid: 'u2', displayName: 'User Two' }
      );

      expect(roomId).toBe('legacy-room-id');
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('falls back gracefully when getDocs throws an error during room lookup', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => false
      });
      mockGetDocs.mockRejectedValueOnce(new Error('Permission denied'));

      const roomId = await getOrCreateDirectChat(
        { uid: 'u1', displayName: 'User One' },
        { uid: 'u2', displayName: 'User Two' }
      );

      expect(roomId).toBe('direct_u1_u2');
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  describe('createGroupChat', () => {
    it('creates a new group room document, genesis message, and notifies members', async () => {
      const roomId = await createGroupChat(
        'Team Support',
        ['u2', 'u3'],
        { uid: 'u1', displayName: 'User One' }
      );

      expect(roomId).toBe('new-doc-id');
      expect(mockAddDoc).toHaveBeenNthCalledWith(1, 'col:chatRooms', {
        type: 'group',
        name: 'Team Support',
        memberIds: ['u1', 'u2', 'u3'],
        createdById: 'u1',
        createdByName: 'User One',
        createdAt: 'SERVER_TS',
      });

      expect(mockAddDoc).toHaveBeenNthCalledWith(2, 'col:chatRooms/new-doc-id/messages', {
        roomId: 'new-doc-id',
        text: 'User One created group "Team Support"',
        senderId: 'u1',
        senderName: 'System',
        timestamp: 'SERVER_TS',
        type: 'system',
      });

      expect(mockSendNotification).toHaveBeenCalledTimes(2);
      expect(mockSendNotification).toHaveBeenCalledWith({
        userId: 'u2',
        title: 'Added to group',
        message: 'User One added you to group "Team Support"',
        type: 'info',
        targetId: 'new-doc-id',
        link: '/messages/new-doc-id',
      });
    });
  });

  describe('createAnnouncementRoom', () => {
    it('creates an announcement room document, posts system message, and notifies members', async () => {
      const roomId = await createAnnouncementRoom(
        'Weekly Updates',
        ['u2'],
        { uid: 'u1', displayName: 'Admin User' }
      );

      expect(roomId).toBe('new-doc-id');
      expect(mockAddDoc).toHaveBeenNthCalledWith(1, 'col:chatRooms', {
        type: 'announcement',
        name: 'Weekly Updates',
        memberIds: ['u1', 'u2'],
        createdById: 'u1',
        createdByName: 'Admin User',
        createdAt: 'SERVER_TS',
        lastMessage: {
          text: 'Admin User started announcements for "Weekly Updates"',
          senderId: 'u1',
          senderName: 'System',
          timestamp: 'SERVER_TS',
        },
      });

      expect(mockAddDoc).toHaveBeenNthCalledWith(2, 'col:chatRooms/new-doc-id/messages', {
        roomId: 'new-doc-id',
        text: 'Admin User started announcements for "Weekly Updates"',
        senderId: 'u1',
        senderName: 'System',
        timestamp: 'SERVER_TS',
        type: 'system',
      });

      expect(mockSendNotification).toHaveBeenCalledTimes(1);
      expect(mockSendNotification).toHaveBeenCalledWith({
        userId: 'u2',
        title: 'New announcement channel',
        message: 'Admin User started announcements for "Weekly Updates"',
        type: 'info',
        targetId: 'new-doc-id',
        link: '/messages/new-doc-id',
      });

      expect(mockSendPushNotification).toHaveBeenCalledTimes(1);
      expect(mockSendPushNotification).toHaveBeenCalledWith({
        userId: 'u2',
        title: 'New announcement channel',
        body: 'Admin User started announcements for "Weekly Updates"',
        data: { targetId: 'new-doc-id', link: '/messages/new-doc-id' },
      });
    });

    it('creates an announcement room with audiencePreset and immediately posts initial announcement if provided (#743)', async () => {
      const roomId = await createAnnouncementRoom(
        'Campus News',
        ['u2', 'u3'],
        { uid: 'u1', displayName: 'Naomi' },
        'everyone',
        { text: 'First announcement text', pinned: true }
      );

      expect(roomId).toBe('new-doc-id');
      // 1. Room doc with audiencePreset
      expect(mockAddDoc).toHaveBeenNthCalledWith(1, 'col:chatRooms', {
        type: 'announcement',
        name: 'Campus News',
        memberIds: ['u1', 'u2', 'u3'],
        createdById: 'u1',
        createdByName: 'Naomi',
        createdAt: 'SERVER_TS',
        audiencePreset: 'everyone',
        lastMessage: {
          text: 'First announcement text',
          senderId: 'u1',
          senderName: 'Naomi',
          timestamp: 'SERVER_TS',
        },
      });

      // 2. Genesis system message
      expect(mockAddDoc).toHaveBeenNthCalledWith(2, 'col:chatRooms/new-doc-id/messages', {
        roomId: 'new-doc-id',
        text: 'Naomi started announcements for "Campus News"',
        senderId: 'u1',
        senderName: 'System',
        timestamp: 'SERVER_TS',
        type: 'system',
      });

      // 3. First announcement post
      expect(mockAddDoc).toHaveBeenNthCalledWith(3, 'col:chatRooms/new-doc-id/messages', {
        roomId: 'new-doc-id',
        text: 'First announcement text',
        senderId: 'u1',
        senderName: 'Naomi',
        senderPhoto: '',
        timestamp: 'SERVER_TS',
        type: 'text',
        attachments: [],
        parentId: null,
        pinned: true,
      });
    });
  });

  describe('sendMessage', () => {
    it('returns early if no text and no attachments', async () => {
      await sendMessage('r1', '', { uid: 'u1', displayName: 'User' });
      expect(mockAddDoc).not.toHaveBeenCalled();
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('sends text-only message, updates preview, and sends notifications using passed memberIds', async () => {
      await sendMessage(
        'r1',
        'hello world',
        { uid: 'u1', displayName: 'User One', photoURL: 'p1' },
        [],
        ['u1', 'u2', 'u3']
      );
      
      expect(mockAddDoc).toHaveBeenCalledWith('col:chatRooms/r1/messages', {
        roomId: 'r1',
        text: 'hello world',
        senderId: 'u1',
        senderName: 'User One',
        senderPhoto: 'p1',
        timestamp: 'SERVER_TS',
        type: 'text',
        attachments: [],
        parentId: null,
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1', {
        lastMessage: {
          text: 'hello world',
          senderId: 'u1',
          senderName: 'User One',
          timestamp: 'SERVER_TS'
        }
      });

      expect(mockSendNotification).toHaveBeenCalledTimes(2);
      expect(mockSendNotification).toHaveBeenCalledWith({
        userId: 'u2',
        title: 'New message',
        message: 'User One: hello world',
        type: 'info',
        targetId: 'r1',
        link: '/messages/r1',
      });
      expect(mockSendNotification).toHaveBeenCalledWith({
        userId: 'u3',
        title: 'New message',
        message: 'User One: hello world',
        type: 'info',
        targetId: 'r1',
        link: '/messages/r1',
      });

      // Same trigger also dispatches an OS-level push (#270).
      expect(mockSendPushNotification).toHaveBeenCalledTimes(2);
      expect(mockSendPushNotification).toHaveBeenCalledWith({
        userId: 'u2',
        title: 'New message',
        body: 'User One: hello world',
        data: { targetId: 'r1', link: '/messages/r1' },
      });
    });

    it('sends attachment-only message and fetches room members if not provided', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ memberIds: ['u1', 'u2'] })
      });
      const attachment = { type: 'contact' as const, id: 'c1', name: 'Alice' };
      await sendMessage('r1', '', { uid: 'u1', displayName: 'User One' }, [attachment]);

      expect(mockAddDoc).toHaveBeenCalledWith('col:chatRooms/r1/messages', {
        roomId: 'r1',
        text: '',
        senderId: 'u1',
        senderName: 'User One',
        senderPhoto: '',
        timestamp: 'SERVER_TS',
        type: 'text',
        attachments: [attachment],
        parentId: null,
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1', {
        lastMessage: {
          text: 'Shared contact',
          senderId: 'u1',
          senderName: 'User One',
          timestamp: 'SERVER_TS'
        }
      });

      expect(mockSendNotification).toHaveBeenCalledTimes(1);
      expect(mockSendNotification).toHaveBeenCalledWith({
        userId: 'u2',
        title: 'New message',
        message: 'User One: Shared contact',
        type: 'info',
        targetId: 'r1',
        link: '/messages/r1',
      });
    });

    it('sends reply in thread with parentId and updates room preview with thread prefix (#563)', async () => {
      await sendMessage(
        'r1',
        'reply in thread',
        { uid: 'u1', displayName: 'User One' },
        undefined,
        ['u1', 'u2'],
        'parent-msg-1'
      );

      expect(mockAddDoc).toHaveBeenCalledWith('col:chatRooms/r1/messages', {
        roomId: 'r1',
        text: 'reply in thread',
        senderId: 'u1',
        senderName: 'User One',
        senderPhoto: '',
        timestamp: 'SERVER_TS',
        type: 'text',
        attachments: [],
        parentId: 'parent-msg-1',
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1', {
        lastMessage: {
          text: 'in a thread: reply in thread',
          senderId: 'u1',
          senderName: 'User One',
          timestamp: 'SERVER_TS',
        },
      });
    });

    it('sends an announcement post with channel name as title and custom announcement message (#743)', async () => {
      await sendMessage(
        'r-ann',
        'Campus retreat this Saturday',
        { uid: 'u1', displayName: 'Naomi' },
        undefined,
        ['u1', 'u2'],
        null,
        'announcement',
        'Campus Updates'
      );

      expect(mockSendNotification).toHaveBeenCalledWith({
        userId: 'u2',
        title: 'Campus Updates',
        message: 'Naomi posted an announcement: Campus retreat this Saturday',
        type: 'info',
        targetId: 'r-ann',
        link: '/messages/r-ann',
      });

      expect(mockSendPushNotification).toHaveBeenCalledWith({
        userId: 'u2',
        title: 'Campus Updates',
        body: 'Naomi posted an announcement: Campus retreat this Saturday',
        data: { targetId: 'r-ann', link: '/messages/r-ann' },
      });
    });

    it('routes announcement thread reply notification only to author and thread participants (#743)', async () => {
      // Mock getDocs to return replies in thread
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          { data: () => ({ senderId: 'u3' }) }
        ]
      });
      // Mock parent message author
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ senderId: 'u1', text: 'Original announcement' })
      });

      // u2 replies to u1's announcement in a room with [u1, u2, u3, u4]
      await sendMessage(
        'r-ann',
        'Is transport provided?',
        { uid: 'u2', displayName: 'Bob' },
        undefined,
        ['u1', 'u2', 'u3', 'u4'],
        'parent-ann-1',
        'announcement',
        'Campus Updates'
      );

      // u1 (author) and u3 (participant) notified, but NOT u4 (non-participant in channel)
      expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
      expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u3' }));
      expect(mockSendNotification).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'u4' }));
    });
  });

  describe('acknowledgeAnnouncement', () => {
    it('toggles acknowledgement on and off for the user (#743)', async () => {
      // Toggle on
      await acknowledgeAnnouncement('r1', 'm1', 'u1', []);
      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1/messages/m1', {
        acknowledged: ['u1']
      });

      // Toggle off
      await acknowledgeAnnouncement('r1', 'm1', 'u1', ['u1', 'u2']);
      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1/messages/m1', {
        acknowledged: ['u2']
      });
    });
  });

  describe('markAnnouncementRead', () => {
    it('adds uid to readBy without throwing on error (#743)', async () => {
      await markAnnouncementRead('r1', 'm1', 'u1');
      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1/messages/m1', {
        readBy: { type: 'arrayUnion', args: ['u1'] }
      });
    });
  });

  describe('inviteToGroup', () => {
    it('updates room memberIds, posts system message, and notifies invited members', async () => {
      await inviteToGroup('r1', ['u2'], ['Bob'], 'Alice');

      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1', {
        memberIds: { type: 'arrayUnion', args: ['u2'] }
      });

      expect(mockAddDoc).toHaveBeenCalledWith('col:chatRooms/r1/messages', {
        roomId: 'r1',
        text: 'Alice added Bob to the group',
        senderId: 'system',
        senderName: 'System',
        timestamp: 'SERVER_TS',
        type: 'system'
      });

      expect(mockSendNotification).toHaveBeenCalledWith({
        userId: 'u2',
        title: 'Added to group',
        message: 'Alice added you to the group',
        type: 'info',
        targetId: 'r1',
        link: '/messages/r1',
      });
    });
  });

  describe('leaveGroup', () => {
    it('removes room memberId and posts system message', async () => {
      await leaveGroup('r1', { uid: 'u2', displayName: 'Bob' });

      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1', {
        memberIds: { type: 'arrayRemove', args: ['u2'] }
      });

      expect(mockAddDoc).toHaveBeenCalledWith('col:chatRooms/r1/messages', {
        roomId: 'r1',
        text: 'Bob left the group',
        senderId: 'system',
        senderName: 'System',
        timestamp: 'SERVER_TS',
        type: 'system'
      });
    });
  });

  describe('reactToMessage', () => {
    it('adds a reaction the user has not given yet', async () => {
      await reactToMessage('r1', 'm1', 'u1', '🙏', []);
      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1/messages/m1', {
        reactions: [{ by: 'u1', emoji: '🙏' }],
      });
    });

    it('removes a reaction the user already gave (toggle off)', async () => {
      await reactToMessage('r1', 'm1', 'u1', '🙏', [{ by: 'u1', emoji: '🙏' }, { by: 'u2', emoji: '❤️' }]);
      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1/messages/m1', {
        reactions: [{ by: 'u2', emoji: '❤️' }],
      });
    });
  });

  describe('togglePinMessage', () => {
    it('writes the pinned flag through', async () => {
      await togglePinMessage('r1', 'm1', true);
      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1/messages/m1', { pinned: true });

      await togglePinMessage('r1', 'm1', false);
      expect(mockUpdateDoc).toHaveBeenLastCalledWith('doc:chatRooms/r1/messages/m1', { pinned: false });
    });
  });

  describe('removeMessageForEveryone', () => {
    it('leaves a tombstone — the rules split it from reaction/pin toggles', async () => {
      await removeMessageForEveryone('r1', 'm1', 'u1');
      expect(mockUpdateDoc).toHaveBeenCalledWith('doc:chatRooms/r1/messages/m1', {
        deleted: { by: 'u1', at: 'SERVER_TS' },
      });
    });
  });

  describe('deleteChatRoom', () => {
    it('deletes the room document from Firestore', async () => {
      await deleteChatRoom('r1');
      expect(mockDeleteDoc).toHaveBeenCalledWith('doc:chatRooms/r1');
    });
  });

  describe('canRemoveConvForEveryone', () => {
    it('allows admin or room creator, denies others', () => {
      expect(canRemoveConvForEveryone(null as any, 'u1', false)).toBe(false);
      expect(canRemoveConvForEveryone({ id: 'r1', createdById: 'u1' } as any, 'u1', false)).toBe(true);
      expect(canRemoveConvForEveryone({ id: 'r1', createdById: 'u2' } as any, 'u1', true)).toBe(true);
      expect(canRemoveConvForEveryone({ id: 'r1', createdById: 'u2' } as any, 'u1', false)).toBe(false);
    });
  });
});
