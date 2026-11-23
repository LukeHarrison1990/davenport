// Data shapes shared by the background engine and the interface.

export type AccountKind = 'google' | 'demo';
export type AccountStatus = 'ok' | 'syncing' | 'error' | 'reauth' | 'offline';

export interface Account {
  id: string;
  email: string;
  name: string;
  kind: AccountKind;
  color: string;
  isWorkspace: boolean;
  chatEnabled: boolean;
  status: AccountStatus;
  lastSync?: number;
  error?: string;
  order: number;
}

export interface Addr {
  name?: string;
  email: string;
}

// ---------- Mail ----------

export type SystemLabel =
  | 'INBOX' | 'SENT' | 'DRAFT' | 'TRASH' | 'SPAM' | 'STARRED' | 'IMPORTANT' | 'UNREAD'
  | 'CATEGORY_PERSONAL' | 'CATEGORY_SOCIAL' | 'CATEGORY_PROMOTIONS' | 'CATEGORY_UPDATES' | 'CATEGORY_FORUMS';

export interface Folder {
  accountId: string;
  id: string;
  name: string; // leaf name, e.g. "Acme"
  path: string; // full path, e.g. "Clients/Acme"
  type: 'system' | 'user';
  unread: number;
  total: number;
  color?: string;
  isCategory: boolean;
  hidden?: boolean;
}

export interface MessageSummary {
  accountId: string;
  id: string;
  threadId: string;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  subject: string;
  snippet: string;
  date: number;
  unread: boolean;
  flagged: boolean;
  important: boolean;
  hasAttachments: boolean;
  labelIds: string[];
  categories: { name: string; color: string }[];
  snoozedUntil?: number;
  flagDue?: number;
  threadCount?: number;
  /** Conversation view: who's in the conversation, as Gmail shows it ("Nicola, me"). */
  threadSenders?: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  /** Not a file the user sees: 'invite' is a meeting invitation part, 'amp' marks interactive Gmail-only content. */
  role?: 'invite' | 'amp';
}

export interface MessageDetail extends MessageSummary {
  bcc: Addr[];
  replyTo: Addr[];
  html?: string;
  text?: string;
  attachments: Attachment[];
  messageIdHeader?: string;
  references?: string;
  listUnsubscribe?: string;
  hasRemoteImages: boolean;
  /** Pictures from the internet may be shown without asking (Settings, or the sender is on the "always show" list). */
  remoteImagesAllowed?: boolean;
}

export type FolderRef =
  | { type: 'label'; id: string }
  | { type: 'search'; q: string }
  | { type: 'searchFolder'; id: string }
  | { type: 'flagged' }
  | { type: 'snoozed' }
  | { type: 'scheduled' }
  | { type: 'unified'; label: 'INBOX' | 'SENT' | 'DRAFT' | 'FLAGGED' };

export interface ListQuery {
  accountId: string | 'all';
  folder: FolderRef;
  tab?: 'focused' | 'other' | 'all';
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export interface ComposeAttachment {
  filename: string;
  mimeType: string;
  dataBase64?: string; // in-memory content
  path?: string; // a file on disk
  size: number;
  fromMessage?: { accountId: string; messageId: string; attachmentId: string };
}

export interface Draft {
  localId: string;
  accountId: string;
  from: string;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  html: string;
  attachments: ComposeAttachment[];
  mode: 'new' | 'reply' | 'replyAll' | 'forward';
  inReplyTo?: { messageId: string; threadId: string; messageIdHeader?: string; references?: string };
  sendAt?: number;
  gmailDraftId?: string;
  /** The message id of the draft's saved copy in Gmail, so the cached copy can be replaced or hidden exactly. */
  gmailMessageId?: string;
  importance?: 'normal' | 'high';
}

export interface OutboxItem {
  id: string;
  accountId: string;
  subject: string;
  to: string;
  sendAt: number;
  status: 'waiting' | 'sending' | 'failed';
  error?: string;
  undoable: boolean;
}

export interface Rule {
  id: string;
  accountId: string;
  name: string;
  enabled: boolean;
  conditions: {
    from?: string;
    to?: string;
    subject?: string;
    hasWords?: string;
    hasAttachment?: boolean;
  };
  actions: {
    addLabelId?: string;
    archive?: boolean;
    markRead?: boolean;
    flag?: boolean;
    trash?: boolean;
    forwardTo?: string;
    neverSpam?: boolean;
    markImportant?: boolean;
  };
  serverFilterId?: string;
  where: 'server' | 'local';
}

export type QuickAction =
  | { type: 'move'; labelId: string }
  | { type: 'label'; labelId: string }
  | { type: 'markRead' }
  | { type: 'markUnread' }
  | { type: 'flag' }
  | { type: 'clearFlag' }
  | { type: 'archive' }
  | { type: 'trash' }
  | { type: 'reply'; templateId?: string }
  | { type: 'forward'; to: string }
  | { type: 'task' };

export interface QuickStep {
  id: string;
  accountId: string;
  name: string;
  actions: QuickAction[];
}

export interface Template {
  id: string;
  name: string;
  subject: string;
  html: string;
}

export interface SearchFolder {
  id: string;
  accountId: string | 'all';
  name: string;
  query: string;
}

export interface SendAs {
  email: string;
  displayName: string;
  signature: string;
  isDefault: boolean;
  isPrimary: boolean;
}

export interface Vacation {
  enabled: boolean;
  subject: string;
  html: string;
  startTime?: number;
  endTime?: number;
  restrictToContacts: boolean;
  restrictToDomain: boolean;
  /** Also show as out of office in Calendar (declining new meetings) for the same dates. */
  blockCalendar?: boolean;
}

// ---------- Calendar ----------

export interface CalendarInfo {
  accountId: string;
  id: string;
  name: string;
  color: string;
  primary: boolean;
  selected: boolean;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  kind: 'mine' | 'other' | 'resource';
}

export type EventType = 'default' | 'focusTime' | 'outOfOffice' | 'workingLocation';
export type Response = 'needsAction' | 'accepted' | 'tentative' | 'declined';
export type InviteResponse = 'accepted' | 'tentative' | 'declined';

/** A meeting invitation (or cancellation, or someone's reply) found in an email. */
export interface Invite {
  method: 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH';
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  meetingUrl?: string;
  recurring: boolean;
  organizer?: Addr;
  iAmOrganizer: boolean;
  attendeeCount: number;
  /** Sent by Google Calendar (answered through Google Calendar) rather than Outlook or another system. */
  fromGoogle: boolean;
  inCalendar: boolean;
  myResponse?: Response;
  /** For a REPLY: who responded, and how. */
  reply?: { email: string; name?: string; response: Response };
  /** Titles of other events at the same time. */
  conflicts: string[];
}

export interface Attendee {
  email: string;
  name?: string;
  response: Response;
  optional?: boolean;
  resource?: boolean;
  self?: boolean;
  organizer?: boolean;
}

export interface CalEvent {
  accountId: string;
  calendarId: string;
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  description?: string;
  attendees: Attendee[];
  organizer?: Addr;
  meetUrl?: string;
  eventType: EventType;
  status: 'confirmed' | 'tentative' | 'cancelled';
  color?: string;
  myResponse?: Response;
  recurrence?: string[];
  recurringEventId?: string;
  transparency?: 'opaque' | 'transparent';
  visibility?: 'default' | 'public' | 'private';
  reminders?: number[]; // minutes before
  workingLocation?: string;
  autoDecline?: boolean;
  htmlLink?: string;
  canEdit: boolean;
}

export interface EventSave {
  event: Partial<CalEvent> & { accountId: string; calendarId: string; title: string; start: number; end: number; allDay: boolean };
  addMeet?: boolean;
  notify?: boolean;
  scope?: 'this' | 'all';
  /** For out-of-office entries: also switch on Gmail automatic replies for the same dates. */
  autoReply?: boolean;
}

export interface BusyBlock {
  start: number;
  end: number;
}

export interface FreeBusy {
  email: string;
  busy: BusyBlock[];
  error?: string;
}

// ---------- People ----------

export interface Contact {
  accountId: string;
  id: string;
  name: string;
  givenName?: string;
  familyName?: string;
  emails: string[];
  phones: string[];
  company?: string;
  title?: string;
  photoUrl?: string;
  address?: string;
  notes?: string;
  groups: string[];
  source: 'contacts' | 'directory' | 'other';
  etag?: string;
}

export interface ContactGroup {
  accountId: string;
  id: string;
  name: string;
  count: number;
}

// ---------- Tasks ----------

export interface TaskList {
  accountId: string;
  id: string;
  title: string;
}

export interface Task {
  accountId: string;
  listId: string;
  id: string;
  title: string;
  notes?: string;
  due?: number;
  completed: boolean;
  completedAt?: number;
  linkedMessage?: { messageId: string; subject: string };
  parent?: string;
  position?: string;
}

// ---------- Chat ----------

export interface ChatSpace {
  accountId: string;
  id: string;
  name: string;
  kind: 'space' | 'dm' | 'group';
  unread: number;
  lastActive: number;
  lastPreview?: string;
  memberCount?: number;
  external?: boolean;
}

export interface ChatMessage {
  accountId: string;
  spaceId: string;
  id: string;
  sender: { id: string; name: string; email?: string };
  text: string;
  createTime: number;
  threadId?: string;
  isThreadReply: boolean;
  replyCount?: number;
  attachments: { name: string; url?: string; kind: 'drive' | 'file' | 'link' }[];
  reactions: { emoji: string; count: number; mine: boolean }[];
  mine: boolean;
}

/** Your Google Chat status, read from and written to Google so it matches Chat on the web and phone. */
export interface ChatStatus {
  accountId: string;
  presence: 'active' | 'idle' | 'away' | 'dnd' | 'unknown';
  /** When Do not disturb ends. */
  dndUntil?: number;
  customText?: string;
  customEmoji?: string;
  customUntil?: number;
  /** Davenport needs to be signed in again before it can see or change the status. */
  needsPermission?: boolean;
  /** Google's one-time "Chat app" setting is missing from the Cloud project (needed to send or change anything). */
  needsSetup?: boolean;
}

// ---------- Settings ----------

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  accent: string;
  density: 'compact' | 'standard' | 'roomy';
  readingPane: 'right' | 'bottom' | 'off';
  conversationView: boolean;
  undoSendSeconds: number;
  syncDays: number;
  shortcuts: 'outlook' | 'gmail';
  notifications: boolean;
  notificationSound: boolean;
  focusedInbox: 'off' | 'categories' | 'categoriesAll' | 'important';
  closeToTray: boolean;
  startWithWindows: boolean;
  todoBar: boolean;
  ribbon: 'simplified' | 'classic';
  blockRemoteImages: boolean;
  markReadAfterSeconds: number; // -1 = never, 0 = immediately
  workWeek: number[]; // 0 = Sunday
  dayStartHour: number;
  dayEndHour: number;
  secondTimeZone?: string;
  calendarView: 'day' | 'workweek' | 'week' | 'month' | 'schedule';
  attachAsDriveLinkOverMB: number;
  pollSeconds: number;
  favourites: { accountId: string; labelId: string }[];
  unifiedInbox: boolean;
  /** Check GitHub for new versions and offer them. */
  autoUpdate: boolean;
}

/** Where Davenport's own updating has got to. */
export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error' | 'managed';
  current: string;
  latest?: string;
  notes?: string;
  percent?: number;
  error?: string;
  checkedAt?: number;
  /** A portable copy: updates are a download from the releases page rather than installed in place. */
  portable?: boolean;
}

export const defaultSettings: Settings = {
  theme: 'system',
  accent: '#1F3A5F',
  density: 'standard',
  readingPane: 'right',
  conversationView: true,
  undoSendSeconds: 10,
  syncDays: 90,
  shortcuts: 'outlook',
  notifications: true,
  notificationSound: true,
  focusedInbox: 'categories',
  closeToTray: true,
  startWithWindows: false,
  todoBar: true,
  ribbon: 'simplified',
  blockRemoteImages: true,
  markReadAfterSeconds: 2,
  workWeek: [1, 2, 3, 4, 5],
  dayStartHour: 8,
  dayEndHour: 18,
  calendarView: 'workweek',
  attachAsDriveLinkOverMB: 25,
  pollSeconds: 45,
  favourites: [],
  unifiedInbox: true,
  autoUpdate: true
};

/** Progress of a Send / Receive (F9). */
export interface SyncProgress {
  active: boolean;
  done: number;
  total: number;
  /** What is happening now, e.g. "Mail · you@school.org". */
  label: string;
  /** When the last Send / Receive finished. */
  finishedAt?: number;
}

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  userDataPath: string;
  hasOAuthClient: boolean;
  electron?: string;
  chrome?: string;
}

export type ChangeScope =
  | 'accounts' | 'folders' | 'mail' | 'outbox' | 'calendar' | 'people' | 'tasks' | 'chat' | 'settings' | 'rules';

export interface ChangeEvent {
  scope: ChangeScope;
  accountId?: string;
  ids?: string[];
}

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success' | 'undo';
  text: string;
  action?: { label: string; method: string; args: unknown[] };
  timeoutMs?: number;
}
