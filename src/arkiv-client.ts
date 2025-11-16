import { createWalletClient, createPublicClient, http, webSocket } from '@arkiv-network/sdk';
import { privateKeyToAccount } from '@arkiv-network/sdk/accounts';
import { mendoza } from '@arkiv-network/sdk/chains';
import { stringToPayload, jsonToPayload } from '@arkiv-network/sdk/utils';
import { eq, and, gt, lt } from '@arkiv-network/sdk/query';
import { config } from './config.js';

export interface Task {
  entityKey: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done';
  assignee: string;
  priority: number;
  createdAt: number;
  expiresAt: number;
  expiresIn: number;
}

export interface TaskCreateInput {
  title: string;
  description: string;
  assignee: string;
  priority?: number;
  expiresIn?: number; // seconds
}

export interface TaskUpdateInput {
  status?: 'todo' | 'in-progress' | 'done';
  assignee?: string;
  priority?: number;
}

export class ArkivTaskBoard {
  private walletClient;
  private publicClient;
  private account;

  constructor() {
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);
    
    this.walletClient = createWalletClient({
      chain: mendoza,
      transport: http(config.rpcUrl),
      account: this.account,
    });

    // Use WebSocket transport if available for real-time subscriptions (avoids block range issues)
    // Fallback to HTTP if WS not available
    const transport = config.wsUrl ? webSocket(config.wsUrl) : http(config.rpcUrl);
    
    this.publicClient = createPublicClient({
      chain: mendoza,
      transport,
    });
  }

  /**
   * Create a new task entity on Arkiv
   */
  async createTask(input: TaskCreateInput): Promise<string> {
    const createdAt = Date.now();
    const expiresIn = input.expiresIn || 86400; // Default 24 hours
    const expiresAt = createdAt + (expiresIn * 1000);

    const taskData = {
      title: input.title,
      description: input.description,
      status: 'todo',
      assignee: input.assignee,
      priority: input.priority || 1,
      createdAt,
      expiresAt,
    };

    const { entityKey } = await this.walletClient.createEntity({
      payload: jsonToPayload(taskData),
      contentType: 'application/json',
      attributes: [
        { key: 'type', value: 'task' },
        { key: 'status', value: 'todo' },
        { key: 'assignee', value: input.assignee },
        { key: 'priority', value: String(input.priority || 1) },
        { key: 'createdAt', value: String(createdAt) },
        { key: 'expiresAt', value: String(expiresAt) },
      ],
      expiresIn,
    });

    return entityKey;
  }

  /**
   * Update an existing task by creating a new version entity
   */
  async updateTask(entityKey: string, updates: TaskUpdateInput): Promise<string> {
    // First, get the current task
    const currentTask = await this.getTask(entityKey);
    if (!currentTask) {
      throw new Error(`Task ${entityKey} not found`);
    }

    // Calculate remaining expiration time
    const now = Date.now();
    const remainingExpiresIn = Math.max(0, Math.floor((currentTask.expiresAt - now) / 1000));

    if (remainingExpiresIn <= 0) {
      throw new Error('Task has expired and cannot be updated');
    }

    // Create updated task data
    const updatedData = {
      title: currentTask.title,
      description: currentTask.description,
      status: updates.status || currentTask.status,
      assignee: updates.assignee || currentTask.assignee,
      priority: updates.priority !== undefined ? updates.priority : currentTask.priority,
      createdAt: currentTask.createdAt,
      expiresAt: currentTask.expiresAt,
    };

    // Create new version entity
    const { entityKey: newEntityKey } = await this.walletClient.createEntity({
      payload: jsonToPayload(updatedData),
      contentType: 'application/json',
      attributes: [
        { key: 'type', value: 'task' },
        { key: 'status', value: updatedData.status },
        { key: 'assignee', value: updatedData.assignee },
        { key: 'priority', value: String(updatedData.priority) },
        { key: 'createdAt', value: String(updatedData.createdAt) },
        { key: 'expiresAt', value: String(updatedData.expiresAt) },
        { key: 'previousVersion', value: entityKey },
      ],
      expiresIn: remainingExpiresIn,
    });

    return newEntityKey;
  }

  /**
   * Extend task expiration time
   */
  async extendTask(entityKey: string, additionalSeconds: number): Promise<string> {
    const task = await this.getTask(entityKey);
    if (!task) {
      throw new Error(`Task ${entityKey} not found`);
    }

    const { txHash } = await this.walletClient.extendEntity({
      entityKey: entityKey as `0x${string}`,
      expiresIn: additionalSeconds,
    });

    return txHash;
  }

  /**
   * Get a single task by entity key
   */
  async getTask(entityKey: string): Promise<Task | null> {
    try {
      const entity = await this.publicClient.getEntity(entityKey as `0x${string}`);
      const attrs = Object.fromEntries(
        entity.attributes.map(a => [a.key, a.value])
      );

      if (attrs.type !== 'task') {
        return null;
      }

      const data = entity.toJson();
      return {
        entityKey: entity.key,
        title: data.title,
        description: data.description,
        status: attrs.status as 'todo' | 'in-progress' | 'done',
        assignee: String(attrs.assignee),
        priority: parseInt(String(attrs.priority || '1'), 10),
        createdAt: parseInt(String(attrs.createdAt || '0'), 10),
        expiresAt: parseInt(String(attrs.expiresAt || '0'), 10),
        expiresIn: Math.max(0, Math.floor((parseInt(String(attrs.expiresAt || '0'), 10) - Date.now()) / 1000)),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Query tasks with filters
   */
  async queryTasks(filters?: {
    status?: 'todo' | 'in-progress' | 'done';
    assignee?: string;
    minPriority?: number;
    activeOnly?: boolean;
  }): Promise<Task[]> {
    const query = this.publicClient.buildQuery();
    const conditions = [eq('type', 'task')];

    if (filters?.status) {
      conditions.push(eq('status', filters.status));
    }

    if (filters?.assignee) {
      conditions.push(eq('assignee', filters.assignee));
    }

    if (filters?.minPriority) {
      conditions.push(gt('priority', String(filters.minPriority - 1)));
    }

    if (filters?.activeOnly) {
      const now = Date.now();
      conditions.push(gt('expiresAt', String(now)));
    }

    let queryBuilder = query;
    for (const condition of conditions) {
      queryBuilder = queryBuilder.where(condition);
    }
    const result = await queryBuilder
      .withAttributes(true)
      .withPayload(true)
      .fetch();

    const tasks: Task[] = [];
    const now = Date.now();

    for (const entity of result.entities) {
      try {
        const attrs = Object.fromEntries(
          entity.attributes.map(a => [a.key, a.value])
        );

        // Skip if expired and activeOnly is true
        const expiresAt = parseInt(String(attrs.expiresAt || '0'), 10);
        if (filters?.activeOnly && expiresAt < now) {
          continue;
        }

        const data = entity.toJson();
        tasks.push({
          entityKey: entity.key,
          title: data.title,
          description: data.description,
          status: attrs.status as 'todo' | 'in-progress' | 'done',
          assignee: String(attrs.assignee),
          priority: parseInt(String(attrs.priority || '1'), 10),
          createdAt: parseInt(String(attrs.createdAt || '0'), 10),
          expiresAt,
          expiresIn: Math.max(0, Math.floor((expiresAt - now) / 1000)),
        });
      } catch (error) {
        console.error('Error parsing task entity:', error);
      }
    }

    return tasks.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  }

  /**
   * Subscribe to task events (create, update, extend)
   */
  async subscribeToTasks(callbacks: {
    onTaskCreated?: (task: Task) => void;
    onTaskUpdated?: (task: Task) => void;
    onTaskExtended?: (entityKey: string, newExpirationBlock: number) => void;
    onError?: (error: Error) => void;
  }): Promise<() => void> {
    // Subscribe to new events only (no historical queries to avoid max block range error)
    const stop = await this.publicClient.subscribeEntityEvents({
      onEntityCreated: async (e) => {
        try {
          const task = await this.getTask(e.entityKey);
          if (task) {
            const attrs = Object.fromEntries(
              (await this.publicClient.getEntity(e.entityKey)).attributes.map(a => [a.key, a.value])
            );
            
            if (attrs.previousVersion) {
              callbacks.onTaskUpdated?.(task);
            } else {
              callbacks.onTaskCreated?.(task);
            }
          }
        } catch (err) {
          // Silently ignore block range errors
          const errorMsg = (err as Error)?.message || String(err);
          if (!errorMsg.includes('exceed max block range') && 
              !errorMsg.includes('max block range params') &&
              !errorMsg.includes('InvalidInputRpcError')) {
            callbacks.onError?.(err as Error);
          }
        }
      },
      onEntityExpiresInExtended: (e) => {
        callbacks.onTaskExtended?.(e.entityKey, e.newExpirationBlock);
      },
      onError: (err) => {
        // Silently filter out block range errors - subscriptions still work for new events
        const errorMsg = err?.message || String(err);
        if (!errorMsg.includes('exceed max block range') && 
            !errorMsg.includes('max block range params') &&
            !errorMsg.includes('InvalidInputRpcError')) {
          callbacks.onError?.(err as Error);
        }
        // Block range errors are expected - SDK queries historical blocks but subscriptions work for new events
      },
    });

    return stop;
  }

  /**
   * Get account address
   */
  getAccountAddress(): string {
    return this.account.address;
  }
}

