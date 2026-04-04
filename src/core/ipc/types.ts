import { z } from 'zod';

// --- IPC Task Schemas ---

const containerConfigSchema = z
  .object({
    additionalMounts: z
      .array(
        z.object({
          hostPath: z.string(),
          containerPath: z.string().optional(),
          readonly: z.boolean().optional(),
        }),
      )
      .optional(),
    timeout: z.number().optional(),
  })
  .optional();

const scheduleTaskSchema = z.object({
  type: z.literal('schedule_task'),
  prompt: z.string().min(1),
  schedule_type: z.enum(['cron', 'interval', 'once']),
  schedule_value: z.string().min(1),
  targetJid: z.string().min(1),
  taskId: z.string().min(1).optional(),
  context_mode: z.enum(['group', 'isolated']).optional(),
  script: z.string().optional(),
});

const pauseTaskSchema = z.object({
  type: z.literal('pause_task'),
  taskId: z.string().min(1),
});

const resumeTaskSchema = z.object({
  type: z.literal('resume_task'),
  taskId: z.string().min(1),
});

const cancelTaskSchema = z.object({
  type: z.literal('cancel_task'),
  taskId: z.string().min(1),
});

const updateTaskSchema = z.object({
  type: z.literal('update_task'),
  taskId: z.string().min(1),
  prompt: z.string().min(1).optional(),
  script: z.string().optional(),
  schedule_type: z.enum(['cron', 'interval', 'once']).optional(),
  schedule_value: z.string().min(1).optional(),
});

const refreshGroupsSchema = z.object({
  type: z.literal('refresh_groups'),
});

const registerGroupSchema = z.object({
  type: z.literal('register_group'),
  jid: z.string().min(1),
  name: z.string().min(1),
  folder: z.string().min(1),
  containerConfig: containerConfigSchema,
});

export const ipcTaskSchema = z.discriminatedUnion('type', [scheduleTaskSchema, pauseTaskSchema, resumeTaskSchema, cancelTaskSchema, updateTaskSchema, refreshGroupsSchema, registerGroupSchema]);

export type IpcTaskData = z.infer<typeof ipcTaskSchema>;

// --- IPC Message Schema ---

export const ipcMessageSchema = z.object({
  type: z.literal('message'),
  chatJid: z.string().min(1),
  text: z.string().min(1),
});

export type IpcMessageData = z.infer<typeof ipcMessageSchema>;
