import { createWalletClient, createPublicClient, http, webSocket } from '@arkiv-network/sdk';
import { privateKeyToAccount } from '@arkiv-network/sdk/accounts';
import { mendoza } from '@arkiv-network/sdk/chains';
import { jsonToPayload } from '@arkiv-network/sdk/utils';
import { eq, and, gt } from '@arkiv-network/sdk/query';
import { config } from './config.js';

export interface ChatSession {
  sessionId: string;
  user1: string;
  user2: string;
  status: 'waiting' | 'matched' | 'active' | 'ended';
  createdAt: number;
  expiresAt: number;
  interests?: string[];
}

export interface UserProfile {
  userId: string;
  address: string;
  status: 'online' | 'offline' | 'waiting' | 'chatting';
  interests?: string[];
  createdAt: number;
}

export class ArkivOmegle {
  private walletClient;
  public publicClient: ReturnType<typeof createPublicClient>;
  private account;
  private userId: string;

  constructor() {
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);
    this.userId = `user-${this.account.address.slice(0, 10)}`;
    
    this.walletClient = createWalletClient({
      chain: mendoza,
      transport: http(config.rpcUrl),
      account: this.account,
    });

    // Use WebSocket for real-time subscriptions
    const transport = config.wsUrl ? webSocket(config.wsUrl) : http(config.rpcUrl);
    
    this.publicClient = createPublicClient({
      chain: mendoza,
      transport,
    });
  }

  /**
   * Create or update user profile
   */
  async setUserProfile(interests?: string[]): Promise<string> {
    const profileData: UserProfile = {
      userId: this.userId,
      address: this.account.address,
      status: 'waiting',
      interests,
      createdAt: Date.now(),
    };

    const { entityKey } = await this.walletClient.createEntity({
      payload: jsonToPayload(profileData),
      contentType: 'application/json',
      attributes: [
        { key: 'type', value: 'user-profile' },
        { key: 'userId', value: this.userId },
        { key: 'address', value: this.account.address },
        { key: 'status', value: 'waiting' },
        { key: 'createdAt', value: String(profileData.createdAt) },
      ],
      expiresIn: 3600, // 1 hour
    });

    return entityKey;
  }

  /**
   * Create a waiting session (looking for match)
   */
  async startWaiting(interests?: string[]): Promise<string> {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const createdAt = Date.now();
    const expiresIn = 300; // 5 minutes waiting timeout

    const sessionData: ChatSession = {
      sessionId,
      user1: this.userId,
      user2: '',
      status: 'waiting',
      createdAt,
      expiresAt: createdAt + (expiresIn * 1000),
      interests,
    };

    const { entityKey } = await this.walletClient.createEntity({
      payload: jsonToPayload(sessionData),
      contentType: 'application/json',
      attributes: [
        { key: 'type', value: 'chat-session' },
        { key: 'sessionId', value: sessionId },
        { key: 'user1', value: this.userId },
        { key: 'status', value: 'waiting' },
        { key: 'createdAt', value: String(createdAt) },
        { key: 'expiresAt', value: String(sessionData.expiresAt) },
      ],
      expiresIn,
    });

    return sessionId;
  }

  /**
   * Match with another waiting user
   */
  async matchSession(sessionId: string, matchedUserId: string): Promise<string> {
    // Get current session
    const sessions = await this.getSessions({ sessionId });
    if (sessions.length === 0) {
      throw new Error('Session not found');
    }

    const session = sessions[0];
    const expiresIn = 3600; // 1 hour for active chat

    // Create matched session
    const matchedSession: ChatSession = {
      ...session,
      user2: matchedUserId,
      status: 'matched',
      expiresAt: Date.now() + (expiresIn * 1000),
    };

    const { entityKey } = await this.walletClient.createEntity({
      payload: jsonToPayload(matchedSession),
      contentType: 'application/json',
      attributes: [
        { key: 'type', value: 'chat-session' },
        { key: 'sessionId', value: sessionId },
        { key: 'user1', value: session.user1 },
        { key: 'user2', value: matchedUserId },
        { key: 'status', value: 'matched' },
        { key: 'createdAt', value: String(session.createdAt) },
        { key: 'expiresAt', value: String(matchedSession.expiresAt) },
      ],
      expiresIn,
    });

    return sessionId;
  }

  /**
   * End a chat session
   */
  async endSession(sessionId: string): Promise<void> {
    const sessions = await this.getSessions({ sessionId });
    if (sessions.length === 0) {
      return;
    }

    const session = sessions[0];

    await this.walletClient.createEntity({
      payload: jsonToPayload({
        ...session,
        status: 'ended',
        endedAt: Date.now(),
      }),
      contentType: 'application/json',
      attributes: [
        { key: 'type', value: 'chat-session' },
        { key: 'sessionId', value: sessionId },
        { key: 'status', value: 'ended' },
      ],
      expiresIn: 86400, // Keep ended sessions for 24 hours
    });
  }

  /**
   * Get waiting users (for matching)
   */
  async getWaitingUsers(excludeUserId?: string): Promise<UserProfile[]> {
    const query = this.publicClient.buildQuery();
    const conditions = [
      eq('type', 'user-profile'),
      eq('status', 'waiting'),
    ];

    let queryBuilder = query;
    for (const condition of conditions) {
      queryBuilder = queryBuilder.where(condition);
    }
    const result = await queryBuilder
      .withAttributes(true)
      .withPayload(true)
      .fetch();

    const users: UserProfile[] = [];
    const now = Date.now();

    for (const entity of result.entities) {
      try {
        const attrs = Object.fromEntries(
          entity.attributes.map(a => [a.key, a.value])
        );

        if (excludeUserId && attrs.userId === excludeUserId) {
          continue;
        }

        const data = entity.toJson();
        users.push({
          userId: String(attrs.userId),
          address: String(attrs.address),
          status: attrs.status as any,
          interests: data.interests,
          createdAt: parseInt(String(attrs.createdAt || '0'), 10),
        });
      } catch (error) {
        console.error('Error parsing user profile:', error);
      }
    }

    return users;
  }

  /**
   * Get sessions
   */
  async getSessions(filters?: {
    sessionId?: string;
    userId?: string;
    status?: 'waiting' | 'matched' | 'active' | 'ended';
  }): Promise<ChatSession[]> {
    const query = this.publicClient.buildQuery();
    const conditions = [eq('type', 'chat-session')];

    if (filters?.sessionId) {
      conditions.push(eq('sessionId', filters.sessionId));
    }

    if (filters?.userId) {
      conditions.push(eq('user1', filters.userId));
    }

    if (filters?.status) {
      conditions.push(eq('status', filters.status));
    }

    let queryBuilder = query;
    for (const condition of conditions) {
      queryBuilder = queryBuilder.where(condition);
    }
    const result = await queryBuilder
      .withAttributes(true)
      .withPayload(true)
      .fetch();

    const sessions: ChatSession[] = [];
    const now = Date.now();

    for (const entity of result.entities) {
      try {
        const attrs = Object.fromEntries(
          entity.attributes.map(a => [a.key, a.value])
        );

        // Skip expired waiting sessions
        if (attrs.status === 'waiting') {
          const expiresAt = parseInt(String(attrs.expiresAt || '0'), 10);
          if (expiresAt < now) {
            continue;
          }
        }

        const data = entity.toJson();
        sessions.push({
          sessionId: String(attrs.sessionId),
          user1: String(attrs.user1),
          user2: String(attrs.user2 || ''),
          status: attrs.status as any,
          createdAt: parseInt(String(attrs.createdAt || '0'), 10),
          expiresAt: parseInt(String(attrs.expiresAt || '0'), 10),
          interests: data.interests,
        });
      } catch (error) {
        console.error('Error parsing session:', error);
      }
    }

    // Sort by most recent first
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Subscribe to session matches
   */
  async subscribeToMatches(callbacks: {
    onMatched?: (session: ChatSession) => void;
    onUserWaiting?: (user: UserProfile) => void;
    onSessionEnded?: (sessionId: string) => void;
    onError?: (error: Error) => void;
  }): Promise<() => void> {
    const stop = await this.publicClient.subscribeEntityEvents({
      onEntityCreated: async (e) => {
        try {
          const entity = await this.publicClient.getEntity(e.entityKey as `0x${string}`);
          const attrs = Object.fromEntries(
            entity.attributes.map(a => [a.key, a.value])
          );

          if (attrs.type === 'chat-session') {
            const data = entity.toJson();
            const session: ChatSession = {
              sessionId: String(attrs.sessionId),
              user1: String(attrs.user1),
              user2: String(attrs.user2 || ''),
              status: attrs.status as any,
              createdAt: parseInt(String(attrs.createdAt || '0'), 10),
              expiresAt: parseInt(String(attrs.expiresAt || '0'), 10),
              interests: data.interests,
            };

            if (attrs.status === 'matched' && (session.user1 === this.userId || session.user2 === this.userId)) {
              callbacks.onMatched?.(session);
            } else if (attrs.status === 'ended') {
              callbacks.onSessionEnded?.(session.sessionId);
            }
          } else if (attrs.type === 'user-profile' && attrs.status === 'waiting' && attrs.userId !== this.userId) {
            const data = entity.toJson();
            callbacks.onUserWaiting?.({
              userId: String(attrs.userId),
              address: String(attrs.address),
              status: 'waiting',
              interests: data.interests,
              createdAt: parseInt(String(attrs.createdAt || '0'), 10),
            });
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

  getUserId(): string {
    return this.userId;
  }

  getAccountAddress(): string {
    return this.account.address;
  }
}

