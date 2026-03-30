export interface ChatInfo {
  jid: string;
  name: string;
  lastMessageTime: string;
  channel: string;
  isGroup: boolean;
}

export interface Message {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
  isBotMessage: boolean;
  threadId?: string;
}

export interface ScheduledTask {
  id: string;
  groupFolder: string;
  chatJid: string;
  prompt: string;
  script: string | null;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  contextMode: 'group' | 'isolated';
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
  status: 'active' | 'paused' | 'completed';
  createdAt: string;
}

export interface TaskRunLog {
  taskId: string;
  runAt: string;
  durationMs: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  addedAt: string;
  containerConfig?: ContainerConfig;
  isMain: boolean;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
}

export interface AdditionalMount {
  hostPath: string;
  containerPath?: string;
  readonly?: boolean;
}
