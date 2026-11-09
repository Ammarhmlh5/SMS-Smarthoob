/**
 * SQLite Database with Supabase Sync
 * Local storage that syncs with Supabase cloud database
 */

import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { resolveCampaignQueueStatus } from './campaignQueueStatus';
import {
  CAMPAIGN_CLAIM_LEASE_MS,
  EXPIRED_CLAIM_ERROR,
  getExpiredClaimRecoveryStatus,
} from './campaignClaimLease';
import { createUuid, isUuid } from './ids';
import { validateCampaignDispatch } from './campaignDispatchValidation';

const DB_NAME = 'smarthoop.db';

// =====================
// Types
// =====================

export interface MessageTemplate {
  id: string;
  title: string;
  body: string;
  user_id: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending' | 'conflict';
}

export interface Campaign {
  id: string;
  name: string;
  template_id: string | null;
  connection_id: string | null;
  status: 'draft' | 'preparing' | 'sending' | 'completed' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  user_id: string;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending' | 'conflict';
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  subscriber_phone: string;
  subscriber_name: string;
  message_body: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sent_at: string | null;
  error_message: string | null;
  sync_status: 'synced' | 'pending' | 'conflict';
}

export interface GatewayConnection {
  id: string;
  name: string;
  api_key: string;
  provider: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending' | 'conflict';
}

export interface SyncLog {
  id: number;
  table_name: string;
  record_id: string;
  action: 'create' | 'update' | 'delete';
  timestamp: string;
  synced: boolean;
}

export type OutgoingMessageStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'CLAIMED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'RETRY_WAITING'
  | 'BLOCKED';

export interface OutgoingMessage {
  id: number;
  campaign_id: string;
  phone: string;
  message: string;
  gateway_id: string;
  status: OutgoingMessageStatus;
  retry_count: number;
  max_retry_attempts: number;
  payload_json: string | null;
  last_error: string | null;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
}

// =====================
// Database Helper
// =====================

class Database {
  private db: SQLite.SQLiteDatabase | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private transactionTail: Promise<void> = Promise.resolve();

  private async withTransaction<T>(
    task: (transaction: SQLite.SQLiteDatabase) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      let result!: T;
      if (Platform.OS === 'web') {
        await this.db!.withTransactionAsync(async () => {
          result = await task(this.db!);
        });
      } else {
        await this.db!.withExclusiveTransactionAsync(async (transaction) => {
          result = await task(transaction);
        });
      }
      return result;
    } finally {
      release();
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    const initialization = this.initializeDatabase();
    this.initializationPromise = initialization;
    try {
      await initialization;
      this.isInitialized = true;
    } finally {
      if (this.initializationPromise === initialization) {
        this.initializationPromise = null;
      }
    }
  }

  private async initializeDatabase(): Promise<void> {
    this.db = await SQLite.openDatabaseAsync(DB_NAME);
    await this.createTables();
    await this.migrateLegacyTemplateIds();
    await this.recoverInterruptedCampaigns();

    // Run initial sync after local queue recovery.
    await this.syncWithSupabase();
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.execAsync(`
      -- Templates table
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        user_id TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT DEFAULT 'synced'
      );

      -- Campaigns table
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template_id TEXT,
        connection_id TEXT,
        status TEXT DEFAULT 'draft',
        total_recipients INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT DEFAULT 'synced'
      );

      -- Campaign Recipients table
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        subscriber_phone TEXT NOT NULL,
        subscriber_name TEXT,
        message_body TEXT,
        status TEXT DEFAULT 'pending',
        sent_at TEXT,
        error_message TEXT,
        sync_status TEXT DEFAULT 'synced',
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      );

      -- Gateway Connections table
      CREATE TABLE IF NOT EXISTS gateway_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT DEFAULT 'synced'
      );

      -- Sync Log table
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        action TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        synced INTEGER DEFAULT 0
      );

      -- Outgoing Messages Queue table
      CREATE TABLE IF NOT EXISTS outgoing_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        gateway_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retry_attempts INTEGER NOT NULL DEFAULT 3,
        payload_json TEXT,
        last_error TEXT,
        correlation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_attempt_at TEXT
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_connections_user ON gateway_connections(user_id);
      CREATE INDEX IF NOT EXISTS idx_sync_pending ON sync_log(synced);
      CREATE INDEX IF NOT EXISTS idx_outgoing_status ON outgoing_messages(status);
      CREATE INDEX IF NOT EXISTS idx_outgoing_campaign ON outgoing_messages(campaign_id);
    `);

    // Insert default templates if not exist
    await this.seedDefaultTemplates();
  }

  private async seedDefaultTemplates(): Promise<void> {
    if (!this.db) return;

    const defaultTemplates = [
      {
        id: 'default_1',
        title: 'ترحيب بالعميل',
        body: 'مرحباً {{الاسم}}، شكراً لانضمامك إلى خدماتنا!',
        is_default: true
      },
      {
        id: 'default_2',
        title: 'تأكيد الطلب',
        body: 'عزيزي {{الاسم}}، تم تأكيد طلبك رقم {{رقم_الطلب}}. المبلغ المستحق: {{المبلغ}} ريال.',
        is_default: true
      },
      {
        id: 'default_3',
        title: 'إشعار بالدفع',
        body: '{{الاسم}}، مبلغ {{المبلغ}} ريال مستحق. تاريخ الاستحقاق: {{تاريخ_الاستحقاق}}.',
        is_default: true
      },
      {
        id: 'default_4',
        title: 'تذكير بالموعد',
        body: 'تذكير: موعدك يوم {{التاريخ}} الساعة {{الوقت}}. نرجو الحضور في الوقت المحدد.',
        is_default: true
      },
      {
        id: 'default_5',
        title: 'شكراً بعد الشراء',
        body: 'شكراً لثقتكم بنا {{الاسم}}! نقدر تواصلكم دائماً.',
        is_default: true
      },
      {
        id: 'default_6',
        title: 'إشعار بالشحن',
        body: '{{الاسم}}، تم شحن طلبك رقم {{رقم_الطلب}}. رقم التتبع: {{رقم_التتبع}}',
        is_default: true
      },
      {
        id: 'default_7',
        title: 'تأكيد الدفع',
        body: 'عزيزي {{الاسم}}، تم استلام مبلغ {{المبلغ}} ريال. رقم الفاتورة: {{رقم_الفاتورة}}',
        is_default: true
      }
    ];

    for (const template of defaultTemplates) {
      const existing = await this.db.getFirstAsync<{ id: string }>(
        'SELECT id FROM templates WHERE id = ?',
        [template.id]
      );
      
      if (!existing) {
        const now = new Date().toISOString();
        await this.db.runAsync(
          `INSERT INTO templates (id, title, body, user_id, is_default, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, 'default', ?, ?, ?, 'synced')`,
          [template.id, template.title, template.body, 1, now, now]
        );
      }
    }
  }

  private async migrateLegacyTemplateIds(): Promise<void> {
    if (!this.db) return;

    const legacyTemplates = await this.db.getAllAsync<{ id: string }>(
      'SELECT id FROM templates WHERE is_default = 0',
    );
    const migrations = legacyTemplates
      .filter((template) => !isUuid(template.id))
      .map((template) => ({ oldId: template.id, newId: createUuid() }));
    if (migrations.length === 0) return;

    await this.db.execAsync('BEGIN TRANSACTION');
    try {
      for (const { oldId, newId } of migrations) {
        await this.db.runAsync(
          'UPDATE templates SET id = ?, sync_status = ? WHERE id = ?',
          [newId, 'pending', oldId],
        );
        await this.db.runAsync(
          'UPDATE campaigns SET template_id = ?, sync_status = ?, updated_at = ? WHERE template_id = ?',
          [newId, 'pending', new Date().toISOString(), oldId],
        );
        await this.db.runAsync(
          "UPDATE sync_log SET record_id = ? WHERE table_name = 'templates' AND record_id = ?",
          [newId, oldId],
        );

        const templateSync = await this.db.getFirstAsync<{ id: number }>(
          "SELECT id FROM sync_log WHERE table_name = 'templates' AND record_id = ? AND synced = 0 LIMIT 1",
          [newId],
        );
        if (!templateSync) await this.logSync('templates', newId, 'update');

        const campaignSync = await this.db.getAllAsync<{ id: string }>(
          'SELECT id FROM campaigns WHERE template_id = ?',
          [newId],
        );
        for (const campaign of campaignSync) {
          const pendingCampaignSync = await this.db.getFirstAsync<{ id: number }>(
            "SELECT id FROM sync_log WHERE table_name = 'campaigns' AND record_id = ? AND synced = 0 LIMIT 1",
            [campaign.id],
          );
          if (!pendingCampaignSync) await this.logSync('campaigns', campaign.id, 'update');
        }
      }

      const pendingTemplateSync = await this.db.getAllAsync<{ id: number; record_id: string }>(
        "SELECT id, record_id FROM sync_log WHERE table_name = 'templates' AND synced = 0",
      );
      for (const item of pendingTemplateSync) {
        if (!isUuid(item.record_id)) {
          const localTemplate = await this.db.getFirstAsync<{ id: string }>(
            'SELECT id FROM templates WHERE id = ?',
            [item.record_id],
          );
          if (!localTemplate) {
            await this.db.runAsync('UPDATE sync_log SET synced = 1 WHERE id = ?', [item.id]);
          }
        }
      }

      await this.db.execAsync('COMMIT');
    } catch (error) {
      await this.db.execAsync('ROLLBACK');
      throw error;
    }
  }

  // =====================
  // Template Operations
  // =====================

  async getTemplates(userId: string): Promise<MessageTemplate[]> {
    if (!this.db) await this.initialize();
    
    return await this.db!.getAllAsync<MessageTemplate>(
      'SELECT * FROM templates WHERE user_id = ? OR is_default = 1 ORDER BY updated_at DESC',
      [userId]
    );
  }

  async getTemplate(id: string): Promise<MessageTemplate | null> {
    if (!this.db) await this.initialize();
    
    return await this.db!.getFirstAsync<MessageTemplate>(
      'SELECT * FROM templates WHERE id = ?',
      [id]
    );
  }

  async createTemplate(template: Omit<MessageTemplate, 'sync_status'>): Promise<MessageTemplate> {
    if (!this.db) await this.initialize();
    
    const now = new Date().toISOString();
    const newTemplate: MessageTemplate = {
      ...template,
      sync_status: 'pending',
      created_at: now,
      updated_at: now
    };

    await this.db!.runAsync(
      `INSERT INTO templates (id, title, body, user_id, is_default, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newTemplate.id, newTemplate.title, newTemplate.body, newTemplate.user_id, 
       newTemplate.is_default ? 1 : 0, newTemplate.created_at, newTemplate.updated_at, newTemplate.sync_status]
    );

    // Log for sync
    await this.logSync('templates', newTemplate.id, 'create');
    
    return newTemplate;
  }

  async updateTemplate(id: string, updates: Partial<MessageTemplate>): Promise<void> {
    if (!this.db) await this.initialize();
    
    const now = new Date().toISOString();
    await this.db!.runAsync(
      'UPDATE templates SET title = COALESCE(?, title), body = COALESCE(?, body), updated_at = ?, sync_status = ? WHERE id = ?',
      [updates.title ?? null, updates.body ?? null, now, 'pending', id]
    );

    await this.logSync('templates', id, 'update');
  }

  async deleteTemplate(id: string): Promise<void> {
    if (!this.db) await this.initialize();

    const template = await this.db!.getFirstAsync<{ is_default: number }>(
      'SELECT is_default FROM templates WHERE id = ?',
      [id],
    );
    if (!template || template.is_default === 1) return;

    await this.db!.runAsync('DELETE FROM templates WHERE id = ?', [id]);
    await this.logSync('templates', id, 'delete');
  }

  // =====================
  // Campaign Operations
  // =====================

  async getCampaigns(userId: string): Promise<Campaign[]> {
    if (!this.db) await this.initialize();
    
    return await this.db!.getAllAsync<Campaign>(
      'SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    if (!this.db) await this.initialize();
    
    return await this.db!.getFirstAsync<Campaign>(
      'SELECT * FROM campaigns WHERE id = ?',
      [id]
    );
  }

  async createCampaign(campaign: Omit<Campaign, 'sync_status'>): Promise<Campaign> {
    if (!this.db) await this.initialize();
    
    const now = new Date().toISOString();
    const newCampaign: Campaign = {
      ...campaign,
      sync_status: 'pending',
      created_at: now,
      updated_at: now
    };

    await this.db!.runAsync(
      `INSERT INTO campaigns (id, name, template_id, connection_id, status, total_recipients, sent_count, failed_count, user_id, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newCampaign.id, newCampaign.name, newCampaign.template_id, newCampaign.connection_id,
       newCampaign.status, newCampaign.total_recipients, newCampaign.sent_count, newCampaign.failed_count,
       newCampaign.user_id, newCampaign.created_at, newCampaign.updated_at, newCampaign.sync_status]
    );

    await this.logSync('campaigns', newCampaign.id, 'create');
    return newCampaign;
  }

  async createCampaignDispatch(
    campaign: Omit<Campaign, 'sync_status'>,
    recipients: Omit<CampaignRecipient, 'sync_status'>[],
    gatewayId: string,
    messages: { phone: string; message: string; payload?: unknown }[],
    maxRetries: number,
  ): Promise<void> {
    validateCampaignDispatch(
      campaign.id,
      campaign.total_recipients,
      recipients,
      messages,
    );
    if (!this.db) await this.initialize();

    const now = new Date().toISOString();
    await this.withTransaction(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO campaigns (id, name, template_id, connection_id, status, total_recipients, sent_count, failed_count, user_id, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          campaign.id, campaign.name, campaign.template_id, campaign.connection_id,
          campaign.status, campaign.total_recipients, campaign.sent_count, campaign.failed_count,
          campaign.user_id, now, now,
        ],
      );
      await transaction.runAsync(
        'INSERT INTO sync_log (table_name, record_id, action, timestamp, synced) VALUES (?, ?, ?, ?, 0)',
        ['campaigns', campaign.id, 'create', now],
      );

      for (let index = 0; index < recipients.length; index += 1) {
        const recipient = recipients[index];
        const message = messages[index];

        await transaction.runAsync(
          `INSERT INTO campaign_recipients (id, campaign_id, subscriber_phone, subscriber_name, message_body, status, sent_at, error_message, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
          [
            recipient.id, recipient.campaign_id, recipient.subscriber_phone, recipient.subscriber_name,
            recipient.message_body, recipient.status, recipient.sent_at, recipient.error_message,
          ],
        );
        await transaction.runAsync(
          `INSERT INTO outgoing_messages (
             campaign_id, phone, message, gateway_id, status,
             retry_count, max_retry_attempts, payload_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'PENDING', 0, ?, ?, ?, ?)`,
          [
            campaign.id, message.phone, message.message, gatewayId, maxRetries,
            message.payload ? JSON.stringify(message.payload) : null, now, now,
          ],
        );
      }
    });
  }

  async updateCampaignStatus(id: string, status: Campaign['status'], sentCount?: number, failedCount?: number): Promise<void> {
    if (!this.db) await this.initialize();
    
    const now = new Date().toISOString();
    await this.db!.runAsync(
      'UPDATE campaigns SET status = ?, sent_count = COALESCE(?, sent_count), failed_count = COALESCE(?, failed_count), updated_at = ?, sync_status = ? WHERE id = ?',
      [status, sentCount ?? null, failedCount ?? null, now, 'pending', id]
    );

    await this.logSync('campaigns', id, 'update');
  }

  // =====================
  // Recipient Operations
  // =====================

  async addRecipients(recipients: Omit<CampaignRecipient, 'sync_status'>[]): Promise<void> {
    if (!this.db) await this.initialize();
    
    for (const recipient of recipients) {
      await this.db!.runAsync(
        `INSERT INTO campaign_recipients (id, campaign_id, subscriber_phone, subscriber_name, message_body, status, sent_at, error_message, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
        [recipient.id, recipient.campaign_id, recipient.subscriber_phone, recipient.subscriber_name,
         recipient.message_body, recipient.status, recipient.sent_at, recipient.error_message]
      );
      
    }
  }

  async getRecipients(campaignId: string): Promise<CampaignRecipient[]> {
    if (!this.db) await this.initialize();
    
    return await this.db!.getAllAsync<CampaignRecipient>(
      'SELECT * FROM campaign_recipients WHERE campaign_id = ? ORDER BY id',
      [campaignId]
    );
  }

  async updateRecipientStatus(id: string, status: CampaignRecipient['status'], errorMessage?: string): Promise<void> {
    if (!this.db) await this.initialize();
    
    const sentAt = status === 'sent' ? new Date().toISOString() : null;
    await this.db!.runAsync(
      'UPDATE campaign_recipients SET status = ?, sent_at = COALESCE(?, sent_at), error_message = ? WHERE id = ?',
      [status, sentAt, errorMessage || null, id]
    );

  }

  // =====================
  // Connection Operations
  // =====================

  async getConnections(userId: string): Promise<GatewayConnection[]> {
    if (!this.db) await this.initialize();
    
    return await this.db!.getAllAsync<GatewayConnection>(
      'SELECT * FROM gateway_connections WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  async saveConnection(connection: Omit<GatewayConnection, 'sync_status'>): Promise<GatewayConnection> {
    if (!this.db) await this.initialize();
    
    const now = new Date().toISOString();
    const newConnection: GatewayConnection = {
      ...connection,
      sync_status: 'pending',
      created_at: now,
      updated_at: now
    };

    // Check if exists
    const existing = await this.db!.getFirstAsync<{ id: string }>(
      'SELECT id FROM gateway_connections WHERE id = ?',
      [newConnection.id]
    );

    if (existing) {
      await this.db!.runAsync(
        'UPDATE gateway_connections SET name = ?, api_key = ?, provider = ?, updated_at = ?, sync_status = ? WHERE id = ?',
        [newConnection.name, newConnection.api_key, newConnection.provider, now, 'pending', newConnection.id]
      );
      await this.logSync('gateway_connections', newConnection.id, 'update');
    } else {
      await this.db!.runAsync(
        `INSERT INTO gateway_connections (id, name, api_key, provider, user_id, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newConnection.id, newConnection.name, newConnection.api_key, newConnection.provider,
         newConnection.user_id, newConnection.created_at, newConnection.updated_at, newConnection.sync_status]
      );
      await this.logSync('gateway_connections', newConnection.id, 'create');
    }

    return newConnection;
  }

  // =====================
  // Sync Operations
  // =====================

  private async logSync(tableName: string, recordId: string, action: SyncLog['action']): Promise<void> {
    if (!this.db) return;
    
    await this.db!.runAsync(
      'INSERT INTO sync_log (table_name, record_id, action, timestamp, synced) VALUES (?, ?, ?, ?, 0)',
      [tableName, recordId, action, new Date().toISOString()]
    );
  }

  async syncWithSupabase(): Promise<{ success: boolean; message: string }> {
    if (!this.db) await this.initialize();

    try {
      // Get pending sync items
      const pendingItems = await this.db!.getAllAsync<SyncLog>(
        'SELECT * FROM sync_log WHERE synced = 0 ORDER BY timestamp ASC LIMIT 50'
      );

      // Process each pending item
      let failedItems = 0;
      for (const item of pendingItems) {
        try {
          await this.syncItem(item);
          
          // Mark as synced
          await this.db!.runAsync(
            'UPDATE sync_log SET synced = 1 WHERE id = ?',
            [item.id]
          );

          // Update sync status in source table
          await this.db!.runAsync(
            `UPDATE ${item.table_name} SET sync_status = 'synced' WHERE id = ?`,
            [item.record_id]
          );
        } catch (error) {
          failedItems += 1;
          console.error(`Failed to sync item ${item.id}:`, error);
        }
      }

      // Pull latest from Supabase
      await this.pullFromSupabase();

      if (pendingItems.length === 0) {
        return { success: true, message: 'لا توجد عناصر معلقة؛ تم تحديث البيانات السحابية' };
      }

      return failedItems > 0
        ? { success: false, message: `تعذرت مزامنة ${failedItems} من ${pendingItems.length} عنصر` }
        : { success: true, message: `تم مزامنة ${pendingItems.length} عنصر` };
    } catch (error) {
      console.error('Sync failed:', error);
      return { success: false, message: 'فشلت المزامنة مع الخادم' };
    }
  }

  private async syncItem(item: SyncLog): Promise<void> {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('يلزم تسجيل الدخول لمزامنة البيانات المحلية.');

    switch (item.table_name) {
      case 'templates':
        await this.syncTemplate(item);
        break;
      case 'campaigns':
        await this.syncCampaign(item);
        break;
    }
  }

  private async syncTemplate(item: SyncLog): Promise<void> {
    if (item.action === 'delete') {
      if (!isUuid(item.record_id)) {
        throw new Error(`معرف القالب المحذوف غير صالح للمزامنة: ${item.record_id}`);
      }
      const { error } = await supabase.from('message_templates').delete().eq('id', item.record_id);
      if (error) throw error;
      return;
    }

    const template = await this.db!.getFirstAsync<MessageTemplate>(
      'SELECT * FROM templates WHERE id = ?',
      [item.record_id]
    );

    if (!template) return;
    if (!isUuid(template.id)) {
      throw new Error(`معرف القالب المحلي غير صالح للمزامنة: ${template.id}`);
    }

    const { error } = await supabase.from('message_templates').upsert({
      id: template.id,
      title: template.title,
      body: template.body,
      user_id: template.user_id,
      created_at: template.created_at,
      updated_at: template.updated_at
    }, { onConflict: 'id' });

    if (error) throw error;
  }

  private async syncCampaign(item: SyncLog): Promise<void> {
    const campaign = await this.db!.getFirstAsync<Campaign>(
      'SELECT * FROM campaigns WHERE id = ?',
      [item.record_id]
    );

    if (!campaign) return;

    if (!isUuid(campaign.id)) {
      throw new Error(`معرف الحملة المحلية غير صالح للمزامنة: ${campaign.id}`);
    }

    if (item.action === 'delete') {
      const { error } = await supabase.from('campaigns').delete().eq('id', item.record_id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('campaigns').upsert({
        id: campaign.id,
        name: campaign.name,
        template_id: isUuid(campaign.template_id) ? campaign.template_id : null,
        connection_id: campaign.connection_id,
        status: campaign.status,
        total_recipients: campaign.total_recipients,
        sent_count: campaign.sent_count,
        failed_count: campaign.failed_count,
        user_id: campaign.user_id,
        created_at: campaign.created_at,
        updated_at: campaign.updated_at
      }, { onConflict: 'id' });

      if (error) throw error;
    }
  }

  private async pullFromSupabase(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Pull templates
    const { data: templates, error: templatesError } = await supabase
      .from('message_templates')
      .select('*')
      .eq('user_id', user.id);
    if (templatesError) throw templatesError;

    if (templates && templates.length > 0) {
      for (const template of templates) {
        await this.db!.runAsync(
          `INSERT INTO templates (id, title, body, user_id, is_default, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, 0, ?, ?, 'synced')
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             body = excluded.body,
             user_id = excluded.user_id,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             sync_status = 'synced'
           WHERE templates.sync_status = 'synced'`,
          [template.id, template.title, template.body, template.user_id, template.created_at, template.updated_at]
        );
      }
    }

    // Pull campaigns
    const { data: campaigns, error: campaignsError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('user_id', user.id);
    if (campaignsError) throw campaignsError;

    if (campaigns && campaigns.length > 0) {
      for (const campaign of campaigns) {
        await this.db!.runAsync(
          `INSERT INTO campaigns (id, name, template_id, connection_id, status, total_recipients, sent_count, failed_count, user_id, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             template_id = excluded.template_id,
             connection_id = excluded.connection_id,
             status = excluded.status,
             total_recipients = excluded.total_recipients,
             sent_count = excluded.sent_count,
             failed_count = excluded.failed_count,
             user_id = excluded.user_id,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             sync_status = 'synced'
           WHERE campaigns.sync_status = 'synced'`,
          [campaign.id, campaign.name, campaign.template_id, campaign.connection_id, campaign.status,
           campaign.total_recipients, campaign.sent_count, campaign.failed_count, campaign.user_id,
           campaign.created_at, campaign.updated_at]
        );
      }
    }

  }

  // =====================
  // Outgoing Queue Operations
  // =====================

  async queueCampaignMessages(
    campaignId: string,
    gatewayId: string,
    messages: { phone: string; message: string; payload?: unknown }[],
    maxRetries: number = 3
  ): Promise<void> {
    if (!this.db) await this.initialize();
    const now = new Date().toISOString();

    for (const msg of messages) {
      await this.db!.runAsync(
        `INSERT INTO outgoing_messages (
           campaign_id, phone, message, gateway_id, status,
           retry_count, max_retry_attempts, payload_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'PENDING', 0, ?, ?, ?, ?)`,
        [
          campaignId,
          msg.phone,
          msg.message,
          gatewayId,
          maxRetries,
          msg.payload ? JSON.stringify(msg.payload) : null,
          now,
          now,
        ]
      );
    }
  }

  async claimPendingOutgoingMessages(
    limit: number,
    campaignId: string,
    correlationId: string,
  ): Promise<OutgoingMessage[]> {
    if (!this.db) await this.initialize();

    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('حجم حجز الرسائل يجب أن يكون أكبر من صفر.');
    }

    await this.recoverExpiredOutgoingClaims();

    return this.withTransaction(async (transaction) => {
      const candidates = await transaction.getAllAsync<OutgoingMessage>(
        `SELECT * FROM outgoing_messages
         WHERE campaign_id = ? AND status IN ('PENDING', 'RETRY_WAITING', 'QUEUED')
         ORDER BY id ASC LIMIT ?`,
        [campaignId, limit],
      );
      const claimed: OutgoingMessage[] = [];
      const now = new Date().toISOString();

      for (const candidate of candidates) {
        const result = await transaction.runAsync(
          `UPDATE outgoing_messages
           SET status = 'CLAIMED', correlation_id = ?, updated_at = ?
           WHERE id = ? AND status IN ('PENDING', 'RETRY_WAITING', 'QUEUED')`,
          [correlationId, now, candidate.id],
        );
        if (result.changes === 1) {
          claimed.push({ ...candidate, status: 'CLAIMED', correlation_id: correlationId });
        }
      }

      return claimed;
    });
  }

  async releaseClaimedOutgoingMessages(correlationId: string): Promise<void> {
    if (!this.db) await this.initialize();
    const now = new Date().toISOString();
    await this.db!.runAsync(
      `UPDATE outgoing_messages
       SET status = 'RETRY_WAITING', updated_at = ?
       WHERE correlation_id = ? AND status = 'CLAIMED'`,
      [now, correlationId],
    );
  }

  async refreshClaimedOutgoingMessages(correlationId: string): Promise<void> {
    if (!this.db) await this.initialize();
    const now = new Date().toISOString();
    const expiresBefore = new Date(Date.now() - CAMPAIGN_CLAIM_LEASE_MS).toISOString();
    await this.db!.runAsync(
      `UPDATE outgoing_messages SET updated_at = ?
       WHERE correlation_id = ? AND status IN ('CLAIMED', 'SENDING') AND updated_at > ?`,
      [now, correlationId, expiresBefore],
    );
  }

  async startClaimedOutgoingMessageAttempt(id: number, correlationId: string): Promise<boolean> {
    if (!this.db) await this.initialize();
    const now = new Date().toISOString();
    const expiresBefore = new Date(Date.now() - CAMPAIGN_CLAIM_LEASE_MS).toISOString();
    const result = await this.db!.runAsync(
      `UPDATE outgoing_messages
       SET status = 'SENDING', updated_at = ?, last_attempt_at = ?
       WHERE id = ? AND correlation_id = ?
         AND status IN ('CLAIMED', 'SENDING') AND updated_at > ?`,
      [now, now, id, correlationId, expiresBefore],
    );
    return result.changes === 1;
  }

  async updateOutgoingStatus(
    id: number,
    status: OutgoingMessageStatus,
    updates?: { error?: string; correlationId?: string; incrementRetry?: boolean }
  ): Promise<boolean> {
    if (!this.db) await this.initialize();
    const now = new Date().toISOString();

    let query = `UPDATE outgoing_messages SET status = ?, updated_at = ?, last_attempt_at = ?`;
    const params: (string | number | null)[] = [status, now, now];

    if (updates?.error !== undefined) {
      query += `, last_error = ?`;
      params.push(updates.error);
    }

    if (updates?.correlationId !== undefined) {
      query += `, correlation_id = ?`;
      params.push(updates.correlationId);
    }

    if (updates?.incrementRetry) {
      query += `, retry_count = retry_count + 1`;
    }

    query += ` WHERE id = ?`;
    params.push(id);

    if (updates?.correlationId) {
      query += ` AND status = 'SENDING' AND correlation_id = ?`;
      params.push(updates.correlationId);
    }

    const result = await this.db!.runAsync(query, params);
    return result.changes === 1;
  }

  async completeOutgoingMessage(
    id: number,
    status: 'SENT' | 'FAILED',
    correlationId: string,
    recipientId: string | null,
    error?: string,
  ): Promise<boolean> {
    if (!this.db) await this.initialize();
    const now = new Date().toISOString();

    return this.withTransaction(async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE outgoing_messages
         SET status = ?, last_error = ?, updated_at = ?, last_attempt_at = ?
         WHERE id = ? AND status = 'SENDING' AND correlation_id = ?`,
        [status, error ?? null, now, now, id, correlationId],
      );
      if (result.changes !== 1) return false;

      if (recipientId) {
        const recipientResult = await transaction.runAsync(
          `UPDATE campaign_recipients
           SET status = ?, sent_at = ?, error_message = ?
           WHERE id = ?
             AND campaign_id = (SELECT campaign_id FROM outgoing_messages WHERE id = ?)`,
          [
            status === 'SENT' ? 'sent' : 'failed',
            status === 'SENT' ? now : null,
            error ?? null,
            recipientId,
            id,
          ],
        );
        if (recipientResult.changes !== 1) {
          throw new Error(`تعذر تحديث حالة المستلم المرتبط برسالة الطابور ${id}.`);
        }
      }

      return true;
    });
  }

  async markOutgoingBlocked(campaignId: string, reason: string): Promise<void> {
    if (!this.db) await this.initialize();
    const now = new Date().toISOString();

    await this.withTransaction(async (transaction) => {
      const candidates = await transaction.getAllAsync<{
        id: number;
        payload_json: string | null;
      }>(
        `SELECT id, payload_json FROM outgoing_messages
         WHERE campaign_id = ? AND status IN ('PENDING', 'RETRY_WAITING', 'QUEUED')`,
        [campaignId],
      );

      for (const candidate of candidates) {
        const result = await transaction.runAsync(
        `UPDATE outgoing_messages
         SET status = 'BLOCKED', last_error = ?, updated_at = ?
         WHERE id = ? AND status IN ('PENDING', 'RETRY_WAITING', 'QUEUED')`,
          [reason, now, candidate.id],
        );
        if (result.changes !== 1 || !candidate.payload_json) continue;

        let payload: unknown;
        try {
          payload = JSON.parse(candidate.payload_json);
        } catch (error) {
          throw new Error(`تعذر قراءة بيانات المستلم المرتبطة برسالة الطابور ${candidate.id}.`, {
            cause: error,
          });
        }
        if (typeof payload !== 'object' || payload === null) continue;
        const recipientId = (payload as Record<string, unknown>).recipientId;
        if (typeof recipientId !== 'string') continue;

        const recipientResult = await transaction.runAsync(
          `UPDATE campaign_recipients
           SET status = 'failed', error_message = ?
           WHERE id = ? AND campaign_id = ? AND status = 'pending'`,
          [reason, recipientId, campaignId],
        );
        if (recipientResult.changes !== 1) {
          throw new Error(`تعذر تحديث المستلم المرتبط برسالة الطابور ${candidate.id}.`);
        }
      }
    });
  }

  private async recoverExpiredOutgoingClaims(): Promise<void> {
    if (!this.db) return;
    const now = new Date().toISOString();
    const expiredBefore = new Date(Date.now() - CAMPAIGN_CLAIM_LEASE_MS).toISOString();

    await this.withTransaction(async (transaction) => {
      await transaction.runAsync(
        `UPDATE outgoing_messages
         SET status = ?, updated_at = ?
         WHERE status = 'CLAIMED' AND updated_at <= ?`,
        [getExpiredClaimRecoveryStatus('CLAIMED'), now, expiredBefore],
      );

      const expiredMessages = await transaction.getAllAsync<{
        id: number;
        payload_json: string | null;
      }>(
        `SELECT id, payload_json FROM outgoing_messages
         WHERE status = 'SENDING' AND updated_at <= ?`,
        [expiredBefore],
      );

      for (const message of expiredMessages) {
        const result = await transaction.runAsync(
          `UPDATE outgoing_messages
           SET status = ?, last_error = ?, updated_at = ?
           WHERE id = ? AND status = 'SENDING' AND updated_at <= ?`,
          [
            getExpiredClaimRecoveryStatus('SENDING'),
            EXPIRED_CLAIM_ERROR,
            now,
            message.id,
            expiredBefore,
          ],
        );
        if (result.changes !== 1 || !message.payload_json) continue;

        try {
          const payload: unknown = JSON.parse(message.payload_json);
          if (typeof payload !== 'object' || payload === null) continue;
          const recipientId = (payload as Record<string, unknown>).recipientId;
          if (typeof recipientId !== 'string') continue;
          await transaction.runAsync(
            `UPDATE campaign_recipients
             SET status = 'failed', error_message = ?
             WHERE id = ? AND status = 'pending'`,
            [EXPIRED_CLAIM_ERROR, recipientId],
          );
        } catch (error) {
          console.warn(`تعذر ربط الرسالة المنتهية بالمستلم ${message.id}:`, error);
        }
      }
    });
  }

  private async recoverInterruptedCampaigns(): Promise<void> {
    await this.recoverExpiredOutgoingClaims();
    if (!this.db) return;

    const interruptedCampaigns = await this.db.getAllAsync<{ id: string }>(
      `SELECT id FROM campaigns WHERE status = 'sending'`,
    );

    for (const campaign of interruptedCampaigns) {
      const stats = await this.getCampaignQueueStats(campaign.id);
      const status = resolveCampaignQueueStatus(stats);
      if (status === 'sending') continue;
      await this.updateCampaignStatus(
        campaign.id,
        status,
        stats.sent,
        stats.failed + stats.blocked,
      );
    }
  }

  async getCampaignQueueStats(campaignId: string): Promise<{
    pending: number;
    sending: number;
    sent: number;
    failed: number;
    blocked: number;
    total: number;
  }> {
    if (!this.db) await this.initialize();

    const rows = await this.db!.getAllAsync<{ status: OutgoingMessageStatus; count: number }>(
      `SELECT status, COUNT(*) as count 
       FROM outgoing_messages 
       WHERE campaign_id = ? 
       GROUP BY status`,
      [campaignId]
    );

    const stats = { pending: 0, sending: 0, sent: 0, failed: 0, blocked: 0, total: 0 };
    for (const r of rows) {
      stats.total += r.count;
      if (r.status === 'PENDING' || r.status === 'QUEUED' || r.status === 'RETRY_WAITING') {
        stats.pending += r.count;
      } else if (r.status === 'SENDING' || r.status === 'CLAIMED') {
        stats.sending += r.count;
      } else if (r.status === 'SENT') {
        stats.sent += r.count;
      } else if (r.status === 'FAILED') {
        stats.failed += r.count;
      } else if (r.status === 'BLOCKED') {
        stats.blocked += r.count;
      }
    }

    return stats;
  }

  // =====================
  // Utility Methods
  // =====================

  async getPendingSyncCount(): Promise<number> {
    if (!this.db) await this.initialize();
    
    const result = await this.db!.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM sync_log WHERE synced = 0'
    );
    
    return result?.count || 0;
  }

  async clearAllData(): Promise<void> {
    if (!this.db) await this.initialize();
    
    await this.db!.execAsync(`
      DELETE FROM outgoing_messages;
      DELETE FROM campaign_recipients;
      DELETE FROM campaigns;
      DELETE FROM templates WHERE is_default = 0;
      DELETE FROM gateway_connections;
      DELETE FROM sync_log;
    `);
  }
}

// Export singleton instance
export const database = new Database();