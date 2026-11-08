/**
 * SQLite Database with Supabase Sync
 * Local storage that syncs with Supabase cloud database
 */

import * as SQLite from 'expo-sqlite';
import { supabase } from './supabase';

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

// =====================
// Database Helper
// =====================

class Database {
  private db: SQLite.SQLiteDatabase | null = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.db = await SQLite.openDatabaseAsync(DB_NAME);
    await this.createTables();
    this.isInitialized = true;
    
    // Run initial sync after establishing connection
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

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_connections_user ON gateway_connections(user_id);
      CREATE INDEX IF NOT EXISTS idx_sync_pending ON sync_log(synced);
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
    
    await this.db!.runAsync('DELETE FROM templates WHERE id = ? AND is_default = 0', [id]);
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [recipient.id, recipient.campaign_id, recipient.subscriber_phone, recipient.subscriber_name,
         recipient.message_body, recipient.status, recipient.sent_at, recipient.error_message]
      );
      
      await this.logSync('campaign_recipients', recipient.id, 'create');
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
      'UPDATE campaign_recipients SET status = ?, sent_at = COALESCE(?, sent_at), error_message = ?, sync_status = ? WHERE id = ?',
      [status, sentAt, errorMessage || null, 'pending', id]
    );

    await this.logSync('campaign_recipients', id, 'update');
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

      if (pendingItems.length === 0) {
        return { success: true, message: 'لا توجد عناصر للمزامنة' };
      }

      // Process each pending item
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
          console.error(`Failed to sync item ${item.id}:`, error);
        }
      }

      // Pull latest from Supabase
      await this.pullFromSupabase();

      return { success: true, message: `تم مزامنة ${pendingItems.length} عنصر` };
    } catch (error) {
      console.error('Sync failed:', error);
      return { success: false, message: 'فشلت المزامنة مع الخادم' };
    }
  }

  private async syncItem(item: SyncLog): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    switch (item.table_name) {
      case 'templates':
        await this.syncTemplate(item);
        break;
      case 'campaigns':
        await this.syncCampaign(item);
        break;
      case 'gateway_connections':
        await this.syncConnection(item);
        break;
    }
  }

  private async syncTemplate(item: SyncLog): Promise<void> {
    const template = await this.db!.getFirstAsync<MessageTemplate>(
      'SELECT * FROM templates WHERE id = ?',
      [item.record_id]
    );

    if (!template) return;

    if (item.action === 'delete') {
      await supabase.from('message_templates').delete().eq('id', item.record_id);
    } else {
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
  }

  private async syncCampaign(item: SyncLog): Promise<void> {
    const campaign = await this.db!.getFirstAsync<Campaign>(
      'SELECT * FROM campaigns WHERE id = ?',
      [item.record_id]
    );

    if (!campaign) return;

    if (item.action === 'delete') {
      await supabase.from('campaigns').delete().eq('id', item.record_id);
    } else {
      const { error } = await supabase.from('campaigns').upsert({
        id: campaign.id,
        name: campaign.name,
        template_id: campaign.template_id,
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

  private async syncConnection(item: SyncLog): Promise<void> {
    const connection = await this.db!.getFirstAsync<GatewayConnection>(
      'SELECT * FROM gateway_connections WHERE id = ?',
      [item.record_id]
    );

    if (!connection) return;

    if (item.action === 'delete') {
      await supabase.from('gateway_connections').delete().eq('id', item.record_id);
    } else {
      const { error } = await supabase.from('gateway_connections').upsert({
        id: connection.id,
        name: connection.name,
        api_key: connection.api_key,
        provider: connection.provider,
        user_id: connection.user_id,
        created_at: connection.created_at,
        updated_at: connection.updated_at
      }, { onConflict: 'id' });

      if (error) throw error;
    }
  }

  private async pullFromSupabase(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Pull templates
    const { data: templates } = await supabase
      .from('message_templates')
      .select('*')
      .eq('user_id', user.id);

    if (templates && templates.length > 0) {
      for (const template of templates) {
        await this.db!.runAsync(
          `INSERT OR REPLACE INTO templates (id, title, body, user_id, is_default, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, 0, ?, ?, 'synced')`,
          [template.id, template.title, template.body, template.user_id, template.created_at, template.updated_at]
        );
      }
    }

    // Pull campaigns
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('*')
      .eq('user_id', user.id);

    if (campaigns && campaigns.length > 0) {
      for (const campaign of campaigns) {
        await this.db!.runAsync(
          `INSERT OR REPLACE INTO campaigns (id, name, template_id, connection_id, status, total_recipients, sent_count, failed_count, user_id, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
          [campaign.id, campaign.name, campaign.template_id, campaign.connection_id, campaign.status,
           campaign.total_recipients, campaign.sent_count, campaign.failed_count, campaign.user_id,
           campaign.created_at, campaign.updated_at]
        );
      }
    }

    // Pull connections
    const { data: connections } = await supabase
      .from('gateway_connections')
      .select('*')
      .eq('user_id', user.id);

    if (connections && connections.length > 0) {
      for (const conn of connections) {
        await this.db!.runAsync(
          `INSERT OR REPLACE INTO gateway_connections (id, name, api_key, provider, user_id, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')`,
          [conn.id, conn.name, conn.api_key, conn.provider, conn.user_id, conn.created_at, conn.updated_at]
        );
      }
    }
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