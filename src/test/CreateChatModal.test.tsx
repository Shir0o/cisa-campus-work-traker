import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CreateChatModal from '../components/modals/CreateChatModal';
import * as firestore from 'firebase/firestore';
import { useAuth } from '../components/AuthProvider';
import * as chatService from '../services/chat';

// Mock Auth
vi.mock('../components/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

// Mock Firebase
vi.mock('../lib/firebase', () => ({
  db: 'mock-db',
}));

// Mock Firestore
vi.mock('firebase/firestore', () => ({
  collection: vi.fn().mockReturnValue('mock-collection'),
  query: vi.fn().mockReturnValue('mock-query'),
  orderBy: vi.fn(),
  onSnapshot: vi.fn(),
  doc: vi.fn().mockReturnValue('mock-doc'),
}));

// Mock Chat Service
vi.mock('../services/chat', () => ({
  getOrCreateDirectChat: vi.fn().mockResolvedValue('direct-room-id'),
  createGroupChat: vi.fn().mockResolvedValue('group-room-id'),
  createAnnouncementRoom: vi.fn().mockResolvedValue('announcement-room-id'),
}));

// Mock motion
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const mockUsers = [
  { uid: 'u2', displayName: 'Alice Green', email: 'alice@example.com', approved: true },
  { uid: 'u3', displayName: 'Bob Brown', email: 'bob@example.com', approved: true },
];

describe('CreateChatModal Component', () => {
  const mockOnClose = vi.fn();
  const mockOnSelectRoom = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({
      user: { uid: 'u1', displayName: 'Current User' },
      role: 'manager',
    });
  });

  const asFullTimer = () =>
    (useAuth as any).mockReturnValue({
      user: { uid: 'u1', displayName: 'Current User' },
      role: 'admin',
    });

  const setupOnSnapshot = (usersData: any[]) => {
    (firestore.onSnapshot as any).mockImplementation((q: any, successCallback: any) => {
      successCallback({
        forEach: (fn: any) => {
          usersData.forEach((u) => {
            fn({
              id: u.uid,
              data: () => {
                const { uid, ...rest } = u;
                return rest;
              },
            });
          });
        },
      });
      return vi.fn(); // Unsubscribe
    });
  };

  it('renders the Message tab with the people list and a start button', async () => {
    setupOnSnapshot(mockUsers);
    render(
      <CreateChatModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectRoom={mockOnSelectRoom}
      />
    );

    expect(screen.getByText('New message')).toBeInTheDocument();
    expect(screen.getByText('Alice Green')).toBeInTheDocument();
    expect(screen.getByText('Bob Brown')).toBeInTheDocument();
    // The start button is disabled until someone is picked.
    expect(screen.getByRole('button', { name: /Start conversation/i })).toBeDisabled();
  });

  it('filters users list by search input', async () => {
    setupOnSnapshot(mockUsers);
    render(
      <CreateChatModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectRoom={mockOnSelectRoom}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Find someone by name/i);
    fireEvent.change(searchInput, { target: { value: 'Alice' } });

    expect(screen.getByText('Alice Green')).toBeInTheDocument();
    expect(screen.queryByText('Bob Brown')).not.toBeInTheDocument();
  });

  it('creates a direct chat when exactly one person is picked', async () => {
    setupOnSnapshot(mockUsers);
    render(
      <CreateChatModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectRoom={mockOnSelectRoom}
      />
    );

    fireEvent.click(screen.getByText('Alice Green'));
    fireEvent.click(screen.getByRole('button', { name: /Start conversation/i }));

    await waitFor(() => {
      expect(chatService.getOrCreateDirectChat).toHaveBeenCalledWith(
        { uid: 'u1', displayName: 'Current User' },
        { uid: 'u2', displayName: 'Alice Green' }
      );
      expect(mockOnSelectRoom).toHaveBeenCalledWith('direct-room-id');
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('creates a group chat when several people are picked', async () => {
    setupOnSnapshot(mockUsers);
    render(
      <CreateChatModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectRoom={mockOnSelectRoom}
      />
    );

    // Pick both people — the button becomes "Start group (2)".
    fireEvent.click(screen.getByText('Alice Green'));
    fireEvent.click(screen.getByText('Bob Brown'));

    // A group-name field appears; give it a name.
    const groupNameInput = screen.getByPlaceholderText(/Name this group/i);
    fireEvent.change(groupNameInput, { target: { value: 'My Group Chat' } });

    fireEvent.click(screen.getByRole('button', { name: /Start group \(2\)/i }));

    await waitFor(() => {
      expect(chatService.createGroupChat).toHaveBeenCalledWith(
        'My Group Chat',
        ['u2', 'u3'],
        { uid: 'u1', displayName: 'Current User' }
      );
      expect(mockOnSelectRoom).toHaveBeenCalledWith('group-room-id');
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  // Announcements — a room the whole audience reads and only Full-timers post
  // to. The tab mirrors the firestore.rules gate on creating one.
  it('offers the Announcement tab only to a Full-timer', async () => {
    setupOnSnapshot(mockUsers);
    const { unmount } = render(
      <CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />
    );
    expect(screen.queryByRole('button', { name: /Announcement/i })).not.toBeInTheDocument();
    unmount();

    asFullTimer();
    render(<CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />);
    expect(screen.getByRole('button', { name: /Announcement/i })).toBeInTheDocument();
  });

  it('runs the 3-step Announcement wizard (preset -> compose -> review -> send) (#743)', async () => {
    asFullTimer();
    setupOnSnapshot(mockUsers);
    render(<CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />);

    // Switch to Announcement tab
    fireEvent.click(screen.getByRole('button', { name: /^Announcement$/i }));
    expect(screen.getByText(/Only Full-timers can open one/i)).toBeInTheDocument();

    // Step 1: Channel name and Audience presets
    const nameInput = screen.getByPlaceholderText(/Campus updates|Weekly notes/i);
    fireEvent.change(nameInput, { target: { value: 'Campus updates' } });

    // By default "Everyone in the app" is chosen (or click it)
    expect(screen.getByText(/Everyone in the app/i)).toBeInTheDocument();

    // Click Next -> goes to Step 2
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 2: Compose first post
    expect(screen.getByText(/This goes to/i)).toBeInTheDocument();
    const postArea = screen.getByPlaceholderText(/Write your announcement/i);
    fireEvent.change(postArea, { target: { value: 'Welcome to the semester!' } });

    // Click Review -> goes to Step 3
    fireEvent.click(screen.getByRole('button', { name: /Review/i }));

    // Step 3: Review summary card
    expect(screen.getByText(/What lands on their phone/i)).toBeInTheDocument();
    expect(screen.getByText(/Welcome to the semester!/i)).toBeInTheDocument();

    // Click Send
    const sendBtn = screen.getByRole('button', { name: /Send to/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(chatService.createAnnouncementRoom).toHaveBeenCalledWith(
        'Campus updates',
        ['u2', 'u3'],
        { uid: 'u1', displayName: 'Current User' },
        'everyone',
        { text: 'Welcome to the semester!', attachments: [], pinned: false }
      );
      expect(mockOnSelectRoom).toHaveBeenCalledWith('announcement-room-id');
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('filters out cisa-* test accounts from user list', async () => {
    const usersWithTest = [
      ...mockUsers,
      { uid: 'u4', displayName: 'cisa-test-user', email: 'cisa-test@example.com', approved: true },
    ];
    setupOnSnapshot(usersWithTest);
    render(
      <CreateChatModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectRoom={mockOnSelectRoom}
      />
    );

    expect(screen.getByText('Alice Green')).toBeInTheDocument();
    expect(screen.queryByText('cisa-test-user')).not.toBeInTheDocument();
  });

  it('closes on Escape while open, and not while closed', () => {
    setupOnSnapshot(mockUsers);
    const { unmount } = render(
      <CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    unmount();

    render(<CreateChatModal isOpen={false} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('logs and stops loading when the user fetch fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (firestore.onSnapshot as any).mockImplementation((_q: any, _cb: any, errorCallback: any) => {
      errorCallback(new Error('users boom'));
      return vi.fn();
    });
    render(<CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />);

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching users:', expect.any(Error));
    expect(screen.queryByText(/Fetching people/i)).not.toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('deselects a picked person from the chip and starts over', async () => {
    setupOnSnapshot(mockUsers);
    render(<CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />);

    fireEvent.click(screen.getByText('Alice Green'));
    // The chip shows the picked person with an X to remove them (the same name
    // also appears in the user list row, so scan for the chip container).
    const chip = screen.getAllByText('Alice Green')
      .map((el) => el.closest('.inline-flex'))
      .find((el): el is HTMLElement => el instanceof HTMLElement);
    expect(chip).toBeTruthy();
    fireEvent.click(within(chip!).getByRole('button'));

    expect(chatService.getOrCreateDirectChat).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Start conversation/i })).toBeDisabled();
  });

  it('falls back to first names for the group name when none is given', async () => {
    setupOnSnapshot(mockUsers);
    render(<CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />);

    fireEvent.click(screen.getByText('Alice Green'));
    fireEvent.click(screen.getByText('Bob Brown'));
    fireEvent.click(screen.getByRole('button', { name: /Start group \(2\)/i }));

    await waitFor(() => {
      expect(chatService.createGroupChat).toHaveBeenCalledWith(
        'Alice, Bob',
        ['u2', 'u3'],
        { uid: 'u1', displayName: 'Current User' }
      );
    });
  });

  it('logs and keeps the modal open when starting a conversation fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupOnSnapshot(mockUsers);
    (chatService.getOrCreateDirectChat as any).mockRejectedValueOnce(new Error('boom'));
    render(<CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />);

    fireEvent.click(screen.getByText('Alice Green'));
    fireEvent.click(screen.getByRole('button', { name: /Start conversation/i }));

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start conversation:', expect.any(Error));
    });
    expect(mockOnClose).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('logs and keeps the modal open when creating an announcement room fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (useAuth as any).mockReturnValue({
      user: { uid: 'u1', displayName: 'Current User' },
      role: 'admin',
    });
    setupOnSnapshot(mockUsers);
    (chatService.createAnnouncementRoom as any).mockRejectedValueOnce(new Error('boom'));
    render(<CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />);

    fireEvent.click(screen.getByRole('button', { name: /^Announcement$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Weekly notes/i), {
      target: { value: 'Weekly notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Review/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send to/i }));

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to create announcement room:', expect.any(Error));
    });
    expect(mockOnClose).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('switching tabs resets the announcement step and search', async () => {
    setupOnSnapshot(mockUsers);
    asFullTimer();
    render(<CreateChatModal isOpen={true} onClose={mockOnClose} onSelectRoom={mockOnSelectRoom} />);

    fireEvent.change(screen.getByPlaceholderText(/Find someone by name/i), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByText('Alice Green'));

    // Move to the announcement tab — step is 1, channel name input is shown.
    fireEvent.click(screen.getByRole('button', { name: /^Announcement$/i }));
    expect(screen.getByLabelText(/Channel name/i)).toBeInTheDocument();

    // And back to Message — still empty.
    fireEvent.click(screen.getByRole('button', { name: /^Message$/i }));
    expect(screen.getByRole('button', { name: /Start conversation/i })).toBeDisabled();
  });
});
