// The typed contract between the window and the background engine.
// Every method here is implemented in app/main/ipc.ts and called from the window via window.davenport.

import type {
  Account, AppInfo, CalEvent, CalendarInfo, ChatMessage, ChatSpace, Contact, ContactGroup, Draft, EventSave,
  Folder, FreeBusy, Invite, InviteResponse, ListQuery, UpdateState, MessageDetail, MessageSummary, OutboxItem, QuickStep, Response, Rule, SearchFolder,
  SendAs, Settings, Task, TaskList, Template, Vacation
} from './types';

export interface Api {
  // App
  'app.info'(): AppInfo;
  'app.openExternal'(url: string): void;
  'update.state'(): UpdateState;
  'update.check'(): UpdateState;
  'update.download'(): void;
  'update.install'(): void;
  'app.openWindow'(kind: 'compose' | 'event' | 'message', params: Record<string, string>): void;
  'app.copyText'(text: string): void;
  'app.openThirdPartyLicences'(): void;
  'app.askSaveDraft'(): 'save' | 'discard' | 'cancel';
  'app.copyImage'(src: string): void;
  'app.saveImage'(src: string): string | null;
  'app.closeWindow'(): void;
  'app.pickFiles'(): { filename: string; mimeType: string; path: string; size: number }[];
  'app.windowParams'(): Record<string, string>;
  'app.minimise'(): void;
  'app.maximise'(): void;

  // OAuth client and accounts
  'auth.getClient'(): { clientId: string; hasSecret: boolean; source: 'settings' | 'file' | 'builtin' | 'none'; builtInAvailable: boolean };
  'auth.clearClient'(): void;
  'auth.setClient'(clientId: string, clientSecret: string): void;
  'auth.loadClientFile'(): { clientId: string } | null;
  'accounts.list'(): Account[];
  'accounts.addGoogle'(): Account;
  'accounts.addDemo'(): Account;
  'accounts.remove'(accountId: string): void;
  'accounts.reauth'(accountId: string): Account;
  'accounts.enableChat'(accountId: string): Account;
  'accounts.setColor'(accountId: string, color: string): void;
  'sync.now'(accountId?: string): void;
  'sync.progress'(): import('./types').SyncProgress;

  // Settings
  'settings.get'(): Settings;
  'settings.set'(patch: Partial<Settings>): Settings;

  // Mail
  'mail.folders'(accountId: string): Folder[];
  'mail.list'(q: ListQuery): MessageSummary[];
  'mail.count'(q: ListQuery): { total: number; unread: number };
  'mail.get'(accountId: string, id: string): MessageDetail;
  'mail.thread'(accountId: string, threadId: string): MessageDetail[];
  'mail.loadRemoteImages'(accountId: string, id: string, alwaysFromSender: boolean): void;
  'mail.markRead'(accountId: string, ids: string[], read: boolean): void;
  'mail.flag'(accountId: string, ids: string[], flagged: boolean, due?: number | null): void;
  'mail.label'(accountId: string, ids: string[], add: string[], remove: string[]): void;
  'mail.move'(accountId: string, ids: string[], toLabelId: string, fromLabelId?: string): void;
  'mail.moveToTab'(accountId: string, ids: string[], tab: 'primary' | 'other'): void;
  'mail.archive'(accountId: string, ids: string[]): void;
  'mail.trash'(accountId: string, ids: string[]): void;
  'mail.restore'(accountId: string, ids: string[]): void;
  'mail.deleteForever'(accountId: string, ids: string[]): void;
  'mail.spam'(accountId: string, ids: string[], isSpam: boolean): void;
  'mail.snooze'(accountId: string, ids: string[], until: number): void;
  'mail.unsnooze'(accountId: string, ids: string[]): void;
  'mail.send'(draft: Draft): { outboxId: string; sendAt: number };
  'mail.cancelSend'(outboxId: string): Draft | null;
  'mail.sendNow'(outboxId: string): void;
  'mail.outbox'(): OutboxItem[];
  'mail.saveDraft'(draft: Draft): { gmailDraftId?: string; gmailMessageId?: string };
  'mail.discardDraft'(draft: Draft): void;
  'mail.openDraft'(accountId: string, messageId: string): Draft;
  'demo.receive'(threadId: string): string;
  'invite.get'(accountId: string, messageId: string): Invite | null;
  'invite.respond'(accountId: string, messageId: string, response: InviteResponse, notify: boolean, comment?: string): void;
  'invite.removeCancelled'(accountId: string, messageId: string): void;
  'invite.addToCalendar'(accountId: string, messageId: string): void;
  'mail.prepareReply'(accountId: string, messageId: string, mode: 'reply' | 'replyAll' | 'forward'): Draft;
  'mail.newDraft'(accountId: string, to?: string): Draft;
  'mail.openAttachment'(accountId: string, messageId: string, attachmentId: string, filename: string): void;
  'mail.saveAttachment'(accountId: string, messageId: string, attachmentId: string, filename: string): string | null;
  'mail.createFolder'(accountId: string, path: string): Folder;
  'mail.renameFolder'(accountId: string, labelId: string, newPath: string): void;
  'mail.deleteFolder'(accountId: string, labelId: string): void;
  'mail.setCategory'(accountId: string, labelId: string, isCategory: boolean, color?: string): void;
  'mail.serverSearch'(accountId: string, q: string): MessageSummary[];
  'mail.print'(accountId: string, id: string): void;
  'mail.savePdf'(accountId: string, id: string): string | null;
  'mail.emptyFolder'(accountId: string, labelId: 'TRASH' | 'SPAM'): void;

  'rules.list'(accountId: string): Rule[];
  'rules.save'(rule: Rule): Rule;
  'rules.delete'(accountId: string, ruleId: string): void;
  'quicksteps.list'(): QuickStep[];
  'quicksteps.save'(step: QuickStep): QuickStep;
  'quicksteps.delete'(id: string): void;
  'quicksteps.run'(stepId: string, accountId: string, ids: string[]): void;
  'templates.list'(): Template[];
  'templates.save'(t: Template): Template;
  'templates.delete'(id: string): void;
  'searchFolders.list'(): SearchFolder[];
  'searchFolders.save'(f: SearchFolder): SearchFolder;
  'searchFolders.delete'(id: string): void;
  'gmail.sendAs'(accountId: string): SendAs[];
  'gmail.setSignature'(accountId: string, email: string, html: string): void;
  'gmail.vacation'(accountId: string): Vacation;
  'gmail.setVacation'(accountId: string, v: Vacation): void;

  // Calendar
  'calendar.calendars'(): CalendarInfo[];
  'calendar.setSelected'(accountId: string, calendarId: string, selected: boolean): void;
  'calendar.subscribe'(accountId: string, email: string): CalendarInfo;
  'calendar.events'(start: number, end: number): CalEvent[];
  'calendar.get'(accountId: string, calendarId: string, id: string): CalEvent;
  'calendar.isAutoReplyLinked'(accountId: string, calendarId: string, id: string): boolean;
  'calendar.save'(s: EventSave): CalEvent;
  'calendar.delete'(accountId: string, calendarId: string, id: string, scope?: 'this' | 'all'): void;
  'calendar.respond'(accountId: string, calendarId: string, id: string, response: Response): void;
  'calendar.freeBusy'(accountId: string, emails: string[], start: number, end: number): FreeBusy[];
  'calendar.rooms'(accountId: string): { email: string; name: string; capacity?: number }[];
  'calendar.fromMessage'(accountId: string, messageId: string): Partial<CalEvent>;

  // People
  'people.list'(accountId: string | 'all', groupId?: string): Contact[];
  'people.search'(q: string, limit?: number): Contact[];
  'people.directory'(accountId: string, q: string): Contact[];
  'people.directoryList'(accountId: string): Contact[];
  'people.directoryStatus'(accountId: string): { count: number; error?: string };
  'people.syncDirectory'(accountId: string): number;
  'people.groups'(accountId: string | 'all'): ContactGroup[];
  'people.save'(c: Contact): Contact;
  'people.delete'(accountId: string, id: string): void;
  'people.createGroup'(accountId: string, name: string): ContactGroup;

  // Tasks
  'tasks.lists'(): TaskList[];
  'tasks.list'(accountId: string, listId: string, showCompleted?: boolean): Task[];
  'tasks.myDay'(): Task[];
  'tasks.save'(t: Task): Task;
  'tasks.delete'(accountId: string, listId: string, id: string): void;
  'tasks.createList'(accountId: string, title: string): TaskList;

  // Chat
  'chat.spaces'(accountId: string | 'all'): ChatSpace[];
  'chat.messages'(accountId: string, spaceId: string): ChatMessage[];
  'chat.thread'(accountId: string, spaceId: string, threadId: string): ChatMessage[];
  'chat.send'(accountId: string, spaceId: string, text: string, threadId?: string): ChatMessage;
  'chat.react'(accountId: string, spaceId: string, messageId: string, emoji: string): void;
  'chat.markRead'(accountId: string, spaceId: string): void;
  'chat.refresh'(accountId: string, spaceId?: string): void;
  'chat.openInBrowser'(accountId: string, spaceId: string): void;
  'chat.statuses'(): import('./types').ChatStatus[];
  'chat.setPresence'(accountId: string, mode: 'automatic' | 'away' | 'dnd', until?: number): void;
  'chat.setCustomStatus'(accountId: string, text: string | null, emoji?: string, until?: number): void;
  'chat.openSetup'(accountId: string): void;
}

export type ApiMethod = keyof Api;
export type ApiArgs<M extends ApiMethod> = Parameters<Api[M]>;
export type ApiResult<M extends ApiMethod> = Awaited<ReturnType<Api[M]>>;

/** Events pushed from the engine to every window. */
export interface EngineEvents {
  changed: import('./types').ChangeEvent;
  toast: import('./types').Toast;
  navigate: { module: string; accountId?: string; id?: string; threadId?: string };
  syncStatus: { accountId: string; status: import('./types').AccountStatus; detail?: string };
  syncProgress: import('./types').SyncProgress;
  update: import('./types').UpdateState;
}
