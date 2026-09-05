import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Search,
  Loader2,
  Users,
  UserPlus,
  Paperclip,
  Pin,
  Send,
  Bell,
  Check
} from 'lucide-react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { AppUser, ChatAttachment } from '../../types';
import { useAuth } from '../AuthProvider';
import { useLanguage } from '../LanguageProvider';
import { getOrCreateDirectChat, createGroupChat, createAnnouncementRoom } from '../../services/chat';
import { getUserInitials, firstName } from '../../lib/utils';
import AttachDataModal from './AttachDataModal';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRoom: (roomId: string) => void;
}

export default function CreateChatModal({ isOpen, onClose, onSelectRoom }: CreateChatModalProps) {
  const { user: currentUser, role } = useAuth();
  const { t } = useLanguage();
  const canAnnounce = role === 'admin';
  const [tab, setTab] = useState<'message' | 'announcement'>('message');
  const [users, setUsers] = useState<AppUser[]>([]);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');

  // 3-step announcement state (#743)
  const [announceStep, setAnnounceStep] = useState<1 | 2 | 3>(1);
  const [announceName, setAnnounceName] = useState('');
  const [audiencePreset, setAudiencePreset] = useState<'everyone' | 'custom'>('everyone');
  const [announceBody, setAnnounceBody] = useState('');
  const [announceAttachments, setAnnounceAttachments] = useState<ChatAttachment[]>([]);
  const [announcePinned, setAnnouncePinned] = useState(false);
  const [isAttachOpen, setIsAttachOpen] = useState(false);

  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !currentUser) return;

    setFetching(true);
    const usersQuery = query(collection(db, 'users'), orderBy('displayName', 'asc'));
    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const usersList: AppUser[] = [];
        snapshot.forEach((doc) => {
          const u = doc.data() as AppUser;
          // Exclude current user and test accounts
          const email = (u.email || '').toLowerCase();
          const displayName = (u.displayName || '').toLowerCase();
          const isTest = email.startsWith('cisa-') || displayName.startsWith('cisa-');
          if (doc.id !== currentUser.uid && u.approved && !isTest) {
            usersList.push({ uid: doc.id, ...u });
          }
        });
        setUsers(usersList);
        setFetching(false);
      },
      (error) => {
        console.error('Error fetching users:', error);
        setFetching(false);
      }
    );

    return unsubscribe;
  }, [isOpen, currentUser]);

  const filteredUsers = users.filter((u) => {
    const queryStr = search.toLowerCase();
    return (
      u.displayName.toLowerCase().includes(queryStr) ||
      u.email.toLowerCase().includes(queryStr)
    );
  });

  const toggleSelectUser = (uid: string) => {
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  // The design's `start()`: one person → a direct chat, several → a group.
  const startMessage = async () => {
    if (!currentUser || selectedUids.length === 0) return;
    setLoading(true);
    try {
      if (selectedUids.length === 1) {
        const target = users.find((u) => u.uid === selectedUids[0]);
        const roomId = await getOrCreateDirectChat(
          { uid: currentUser.uid, displayName: currentUser.displayName || 'Member' },
          { uid: target!.uid, displayName: target!.displayName }
        );
        onSelectRoom(roomId);
      } else {
        const roomId = await createGroupChat(
          groupName.trim() || selectedUids.map((id) => firstName(users.find((u) => u.uid === id)?.displayName || 'Someone')).join(', '),
          selectedUids,
          { uid: currentUser.uid, displayName: currentUser.displayName || 'Member' }
        );
        onSelectRoom(roomId);
      }
      onClose();
    } catch (error) {
      console.error('Failed to start conversation:', error);
    } finally {
      setLoading(false);
    }
  };

  const announcementMemberUids = audiencePreset === 'everyone'
    ? users.map((u) => u.uid)
    : selectedUids;

  const handleSendAnnouncement = async () => {
    if (!currentUser || !announceName.trim() || announcementMemberUids.length === 0) return;
    setLoading(true);
    try {
      const initialPost = announceBody.trim() || announceAttachments.length > 0
        ? {
            text: announceBody.trim(),
            attachments: announceAttachments,
            pinned: announcePinned,
          }
        : undefined;

      const roomId = await createAnnouncementRoom(
        announceName.trim(),
        announcementMemberUids,
        { uid: currentUser.uid, displayName: currentUser.displayName || 'Member' },
        audiencePreset,
        initialPost
      );
      onSelectRoom(roomId);
      onClose();
    } catch (error) {
      console.error('Failed to create announcement room:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-scrim/55 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', duration: 0.4 }}
            className="relative w-full max-w-md h-[560px] bg-surface rounded-3xl border border-outline-variant shadow-2xl overflow-hidden flex flex-col z-[101]"
          >
            <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between bg-surface-container-low shrink-0">
              <h3 className="font-serif text-xl text-on-surface">
                {tab === 'announcement' && announceStep === 2
                  ? announceName.trim() || t('modals.announcement')
                  : tab === 'announcement' && announceStep === 3
                  ? t('modals.review')
                  : t('modals.new_message')}
              </h3>
              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="p-2 rounded-full hover:bg-surface-container-high transition-colors text-on-surface-variant cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(tab === 'message' || announceStep === 1) && (
              <div className="flex border-b border-outline-variant shrink-0 bg-surface-container-low/55 p-1.5 gap-1">
                <button
                  onClick={() => {
                    setTab('message');
                    setSearch('');
                    setSelectedUids([]);
                    setGroupName('');
                  }}
                  className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                    tab === 'message'
                      ? 'bg-primary text-on-primary '
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {t('modals.message')}
                </button>
                {canAnnounce && (
                  <button
                    onClick={() => {
                      setTab('announcement');
                      setAnnounceStep(1);
                      setSearch('');
                      setSelectedUids([]);
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                      tab === 'announcement'
                        ? 'bg-primary text-on-primary '
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {t('modals.announcement')}
                  </button>
                )}
              </div>
            )}

            {(tab === 'message' || (tab === 'announcement' && announceStep === 1 && audiencePreset === 'custom')) && (
              <div className="px-5 py-3 border-b border-outline-variant bg-surface shrink-0 flex items-center gap-3">
                <Search className="w-4 h-4 text-on-surface-variant shrink-0" />
                <input
                  type="text"
                  placeholder={t('modals.find_someone')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/70"
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 bg-surface-container-lowest">
              {fetching ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-on-surface-variant">
                  <Loader2 className="w-8 h-8 animate-spin text-accent" />
                  <span className="text-xs">{t('modals.fetching_people')}</span>
                </div>
              ) : tab === 'message' ? (
                <>
                  {selectedUids.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {selectedUids.map((uid) => {
                        const p = users.find((u) => u.uid === uid);
                        return (
                          <span
                            key={uid}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-accent text-xs font-semibold"
                          >
                            {p?.displayName || uid}
                            <button
                              onClick={() => toggleSelectUser(uid)}
                              className="p-0.5 rounded-full hover:bg-primary/15 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {selectedUids.length > 1 && (
                    <input
                      type="text"
                      placeholder={t('modals.name_group_optional')}
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl bg-surface border border-outline focus:border-primary outline-none transition-all text-sm text-on-surface mb-3"
                    />
                  )}

                  {filteredUsers.length === 0 ? (
                    <div className="text-center py-12 text-on-surface-variant text-sm">
                      {t('modals.nobody_by_that_name')}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredUsers.map((u) => {
                        const isSelected = selectedUids.includes(u.uid);
                        return (
                          <div
                            key={u.uid}
                            onClick={() => toggleSelectUser(u.uid)}
                            className={`p-3 rounded-2xl border flex items-center gap-3 transition-all cursor-pointer ${
                              isSelected
                                ? 'border-primary bg-primary/5 text-on-surface'
                                : 'border-outline-variant/60 bg-surface text-on-surface hover:bg-surface-container-high'
                            }`}
                          >
                            <div className="w-10 h-10 rounded-full bg-primary/10 text-accent font-semibold flex items-center justify-center text-sm shrink-0">
                              {u.photoURL ? (
                                <img src={u.photoURL} alt={u.displayName} className="w-full h-full object-cover rounded-full" />
                              ) : (
                                getUserInitials(u.displayName)
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="font-semibold text-sm text-on-surface truncate">
                                {u.displayName}
                              </h4>
                              <p className="text-xs text-on-surface-variant truncate">
                                {u.email}
                              </p>
                            </div>
                            {isSelected && (
                              <div className="w-5 h-5 rounded-full bg-primary text-on-primary flex items-center justify-center shrink-0">
                                <Check className="w-3 h-3" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div>
                  {announceStep === 1 && (
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="announce-name" className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                          {t('modals.announcement_name_label')}
                        </label>
                        <input
                          id="announce-name"
                          type="text"
                          required
                          placeholder={t('modals.announcement_placeholder')}
                          value={announceName}
                          onChange={(e) => setAnnounceName(e.target.value)}
                          className="w-full h-11 px-4 rounded-xl bg-surface border border-outline focus:border-primary outline-none transition-all text-sm text-on-surface"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                          {t('modals.announcement_audience_label')}
                        </label>
                        <div className="space-y-2">
                          <div
                            onClick={() => setAudiencePreset('everyone')}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                              audiencePreset === 'everyone'
                                ? 'border-primary bg-primary/5 text-on-surface'
                                : 'border-outline bg-surface text-on-surface hover:bg-surface-container-high'
                            }`}
                          >
                            <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-on-surface-variant shrink-0">
                              <Users className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold">{t('modals.audience_everyone')}</div>
                              <div className="text-xs text-on-surface-variant">{t('modals.audience_everyone_sub')}</div>
                            </div>
                            <span className="text-xs font-semibold tabular-nums text-on-surface-variant">
                              {users.length}
                            </span>
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                              audiencePreset === 'everyone' ? 'border-primary bg-primary' : 'border-outline'
                            }`}>
                              {audiencePreset === 'everyone' && <div className="w-1.5 h-1.5 rounded-full bg-on-primary" />}
                            </div>
                          </div>

                          <div
                            onClick={() => setAudiencePreset('custom')}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                              audiencePreset === 'custom'
                                ? 'border-primary bg-primary/5 text-on-surface'
                                : 'border-outline bg-surface text-on-surface hover:bg-surface-container-high'
                            }`}
                          >
                            <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-on-surface-variant shrink-0">
                              <UserPlus className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold">{t('modals.audience_custom')}</div>
                              <div className="text-xs text-on-surface-variant">{t('modals.audience_custom_sub')}</div>
                            </div>
                            <span className="text-xs font-semibold tabular-nums text-on-surface-variant">
                              {selectedUids.length > 0 ? selectedUids.length : '—'}
                            </span>
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                              audiencePreset === 'custom' ? 'border-primary bg-primary' : 'border-outline'
                            }`}>
                              {audiencePreset === 'custom' && <div className="w-1.5 h-1.5 rounded-full bg-on-primary" />}
                            </div>
                          </div>
                        </div>
                      </div>

                      {audiencePreset === 'custom' && (
                        <div className="space-y-1.5 max-h-[160px] overflow-y-auto pt-1">
                          {filteredUsers.map((u) => {
                            const isSelected = selectedUids.includes(u.uid);
                            return (
                              <div
                                key={u.uid}
                                onClick={() => toggleSelectUser(u.uid)}
                                className={`p-2.5 rounded-xl border flex items-center gap-3 transition-all cursor-pointer ${
                                  isSelected
                                    ? 'border-primary bg-primary/5'
                                    : 'border-outline-variant/60 bg-surface hover:bg-surface-container-high'
                                }`}
                              >
                                <div className="w-7 h-7 rounded-full bg-primary/10 text-accent font-semibold flex items-center justify-center text-xs shrink-0">
                                  {getUserInitials(u.displayName)}
                                </div>
                                <div className="min-w-0 flex-1 text-xs">
                                  <div className="font-semibold text-on-surface truncate">{u.displayName}</div>
                                  <div className="text-on-surface-variant text-[10px] truncate">{u.email}</div>
                                </div>
                                {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {announceStep === 2 && (
                    <div className="space-y-3">
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                        <Bell className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                        <span>
                          {t('modals.announcement_warning').replace('{count}', String(announcementMemberUids.length))}
                        </span>
                      </div>

                      <textarea
                        rows={6}
                        value={announceBody}
                        onChange={(e) => setAnnounceBody(e.target.value)}
                        placeholder={t('modals.announcement_body_placeholder')}
                        className="w-full p-3.5 rounded-2xl bg-surface border border-outline focus:border-primary outline-none text-sm text-on-surface resize-none placeholder:text-on-surface-variant/60"
                      />

                      {announceAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {announceAttachments.map((a, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-accent text-xs font-semibold"
                            >
                              <span>{a.name || a.type}</span>
                              <button
                                onClick={() => setAnnounceAttachments((prev) => prev.filter((_, i) => i !== idx))}
                                className="p-0.5 rounded-full hover:bg-primary/15 cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setIsAttachOpen(true)}
                          className="px-3 py-1.5 rounded-xl border border-outline bg-surface text-xs font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5 cursor-pointer"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                          <span>{t('modals.attach')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setAnnouncePinned(!announcePinned)}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                            announcePinned
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-outline bg-surface text-on-surface hover:bg-surface-container-high'
                          }`}
                        >
                          <Pin className="w-3.5 h-3.5" />
                          <span>{t('modals.pin_it')}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {announceStep === 3 && (
                    <div className="space-y-4">
                      <div className="p-4 rounded-2xl border border-outline bg-surface space-y-3">
                        <div className="flex items-start gap-2 text-xs text-on-surface">
                          <Users className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
                          <span>
                            {t('modals.announcement_review_recipients')
                              .replace('{audience}', audiencePreset === 'everyone' ? t('modals.audience_everyone') : t('modals.audience_custom'))
                              .replace('{count}', String(announcementMemberUids.length))}
                          </span>
                        </div>
                        <div className="flex items-start gap-2 text-xs text-on-surface">
                          <Bell className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
                          <span>
                            {t('modals.announcement_review_pushes').replace('{count}', String(announcementMemberUids.length))}
                          </span>
                        </div>
                        <div className="flex items-start gap-2 text-xs text-on-surface-variant">
                          <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <span>{t('modals.announcement_review_replies')}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <span className="px-2.5 py-0.5 rounded-full bg-surface-container-high text-[11px] font-semibold text-on-surface">
                            {announceName}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-surface-container-high text-[11px] font-semibold text-on-surface">
                            {announcementMemberUids.length} people
                          </span>
                          {announcePinned && (
                            <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                              {t('modals.pinned')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-on-surface-variant mb-1.5">
                          {t('modals.announcement_preview_label')}
                        </div>
                        <div className="p-3.5 rounded-2xl bg-surface-container-high border border-outline-variant flex items-start gap-3">
                          <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                            <Bell className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-xs text-on-surface truncate">
                                {announceName}
                              </span>
                              <span className="text-[10px] text-on-surface-variant shrink-0">
                                {t('modals.announcement_preview_time')}
                              </span>
                            </div>
                            <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">
                              {t('modals.announcement_preview_author_prefix')
                                .replace('{author}', currentUser.displayName || 'Author')
                                .replace('{preview}', announceBody || '...')}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-outline-variant shrink-0 flex items-center gap-3 bg-surface-container-low">
              {tab === 'message' ? (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 h-11 rounded-full font-semibold text-accent hover:bg-primary/5 transition-all text-sm cursor-pointer"
                  >
                    {t('modals.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void startMessage()}
                    disabled={loading || selectedUids.length === 0}
                    className="flex-[2] h-11 rounded-full bg-primary text-on-primary font-semibold hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {loading ? (
                      <span className="animate-pulse">{t('modals.starting')}</span>
                    ) : selectedUids.length > 1 ? (
                      t('modals.start_group').replace('{n}', String(selectedUids.length))
                    ) : (
                      t('modals.start_conversation')
                    )}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-on-surface-variant/70 flex-1 truncate">
                    {announceStep === 1 && t('modals.announcement_gate_note')}
                  </span>
                  {announceStep > 1 && (
                    <button
                      type="button"
                      onClick={() => setAnnounceStep((prev) => (prev - 1) as 1 | 2)}
                      className="px-4 h-11 rounded-full font-semibold text-on-surface hover:bg-surface-container-high transition-all text-sm cursor-pointer"
                    >
                      {t('modals.back')}
                    </button>
                  )}
                  {announceStep === 1 && (
                    <>
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 h-11 rounded-full font-semibold text-accent hover:bg-primary/5 transition-all text-sm cursor-pointer"
                      >
                        {t('modals.cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={!announceName.trim() || announcementMemberUids.length === 0}
                        onClick={() => setAnnounceStep(2)}
                        className="px-6 h-11 rounded-full bg-primary text-on-primary font-semibold hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      >
                        {t('modals.next')}
                      </button>
                    </>
                  )}
                  {announceStep === 2 && (
                    <button
                      type="button"
                      onClick={() => setAnnounceStep(3)}
                      className="px-6 h-11 rounded-full bg-primary text-on-primary font-semibold hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer text-sm"
                    >
                      {t('modals.review')}
                    </button>
                  )}
                  {announceStep === 3 && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void handleSendAnnouncement()}
                      className="px-6 h-11 rounded-full bg-primary text-on-primary font-semibold hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 text-sm flex items-center gap-2"
                    >
                      {loading ? (
                        <span className="animate-pulse">{t('modals.sending')}</span>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>
                            {t('modals.send_to_n').replace('{n}', String(announcementMemberUids.length))}
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>

          <AttachDataModal
            isOpen={isAttachOpen}
            onClose={() => setIsAttachOpen(false)}
            onAttach={(att) => {
              setAnnounceAttachments((prev) => [...prev, att]);
              setIsAttachOpen(false);
            }}
          />
        </div>
      )}
    </AnimatePresence>
  );
}
