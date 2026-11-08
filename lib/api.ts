/**
 * API Client for Python Backend
 * Connects phone app to Python backend instead of Edge Functions
 */

let API_BASE_URL = 'http://10.0.2.2:8000'; // Android emulator localhost / change in settings
// const API_BASE_URL = 'http://localhost:8000'; // iOS simulator
// const API_BASE_URL = 'http://192.168.1.x:8000'; // Physical device - change IP

// =====================
// Types
// =====================

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface Template {
  id: string;
  title: string;
  body: string;
}

export interface DocumentAnalysis {
  columns: string[];
  detectedColumns: {
    name: string;
    type: string;
    confidence: number;
  }[];
  rowCount: number;
  sampleData?: Record<string, string>[];
  suggestedPhoneColumn?: string;
  suggestedNameColumn?: string;
}

export interface VariableLink {
  variable: string;
  column: string;
  confidence: number;
}

export interface MessageAnalysis {
  total: number;
  valid: number;
  errors: number;
  issues: Array<{
    row: number;
    issues: Array<{
      type: string;
      message: string;
      value?: string;
    }>;
  }>;
}

export interface PreparedMessages {
  campaignId: string;
  messages: Array<{
    position: number;
    recipient_name: string;
    phone: string;
    body: string;
    status: string;
    error?: string;
  }>;
  summary: {
    total: number;
    valid: number;
    skipped: number;
  };
}

// =====================
// Helper
// =====================

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// =====================
// Health
// =====================

export async function checkHealth(): Promise<{ status: string; timestamp: string }> {
  return fetchApi('/health');
}

// =====================
// Templates
// =====================

export async function getDefaultTemplates(): Promise<Template[]> {
  const result = await fetchApi<ApiResponse<Template[]>>('/api/v1/templates/default/list');
  return result.data || [];
}

export async function getUserTemplates(userId: string): Promise<Template[]> {
  const result = await fetchApi<ApiResponse<Template[]>>('/api/v1/templates', {
    headers: { Authorization: `Bearer ${userId}` }
  });
  return result.data || [];
}

export async function getTemplateVariables(templateId: string): Promise<{ variables: string[] }> {
  const result = await fetchApi<ApiResponse<{ variables: string[] }>>(`/api/v1/templates/${templateId}/variables`);
  return result.data || { variables: [] };
}

// =====================
// Document Processing
// =====================

export type UploadableFile =
  | File
  | { uri: string; name: string; type?: string };

export async function parseDocument(
  file: UploadableFile,
  userId: string
): Promise<DocumentAnalysis> {
  const formData = new FormData();
  formData.append('file', file as any);

  const response = await fetch(`${API_BASE_URL}/api/v1/documents/parse`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userId}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Failed to parse document');
  }

  const result = await response.json();
  const data = result.data;
  
  // Transform backend response to frontend format
  return {
    columns: data.columns || [],
    detectedColumns: (data.detected_fields || []).map((f: any) => ({
      name: f.column_name,
      type: f.detected_type,
      confidence: f.confidence,
    })),
    rowCount: data.row_count || 0,
    sampleData: data.sample_data,
    suggestedPhoneColumn: data.suggested_phone_column,
    suggestedNameColumn: data.suggested_name_column,
  };
}

// =====================
// AI Features
// =====================

export async function suggestTemplate(
  columns: string[],
  records: Record<string, string>[],
  userId: string
): Promise<Array<{
  template_id: string;
  template_title: string;
  match_score: number;
  variables_matched: string[];
  variables_missing: string[];
}>> {
  const result = await fetchApi<ApiResponse<{ suggestions: any[] }>>('/api/v1/ai/suggest-template', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userId}` },
    body: JSON.stringify({ columns, records, user_id: userId })
  });
  
  return result.data?.suggestions || [];
}

export async function autoLinkVariables(
  templateBody: string,
  columns: string[],
  records: Record<string, string>[]
): Promise<VariableLink[]> {
  const result = await fetchApi<ApiResponse<{ links: VariableLink[] }>>('/api/v1/ai/auto-link', {
    method: 'POST',
    body: JSON.stringify({ template_body: templateBody, columns, records })
  });
  
  return result.data?.links || [];
}

export async function analyzeMessages(
  messages: Array<{ phone: string; body: string }>
): Promise<{ analysis: MessageAnalysis; warnings: any[] }> {
  const result = await fetchApi<ApiResponse<{ analysis: MessageAnalysis; warnings: any[] }>>('/api/v1/ai/analyze-messages', {
    method: 'POST',
    body: JSON.stringify({ messages })
  });
  
  return result.data || { analysis: { total: 0, valid: 0, errors: 0, issues: [] }, warnings: [] };
}

// =====================
// Campaign
// =====================

export async function prepareCampaign(params: {
  template_id: string;
  connection_id: string;
  campaign_name: string;
  records: Record<string, string>[];
  column_mapping: Record<string, string>;
  phone_column: string;
  name_column?: string;
  user_id: string;
}): Promise<PreparedMessages> {
  const result = await fetchApi<ApiResponse<PreparedMessages>>('/api/v1/campaigns/prepare', {
    method: 'POST',
    headers: { Authorization: `Bearer ${params.user_id}` },
    body: JSON.stringify(params)
  });
  
  return result.data!;
}

export async function sendCampaign(
  campaignId: string,
  userId: string,
  batchSize: number = 50,
  maxRetries: number = 3
): Promise<{ success: boolean; sent: number; failed: number }> {
  const result = await fetchApi<ApiResponse<{ success: boolean; sent: number; failed: number }>>(
    `/api/v1/campaigns/${campaignId}/send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${userId}` },
      body: JSON.stringify({ batch_size: batchSize, max_retries: maxRetries })
    }
  );
  
  return result.data || { success: false, sent: 0, failed: 0 };
}

// =====================
// Settings
// =====================

export async function getSettings(userId: string): Promise<{ batch_size: number; max_retries: number }> {
  const result = await fetchApi<ApiResponse<{ batch_size: number; max_retries: number }>>('/api/v1/settings', {
    headers: { Authorization: `Bearer ${userId}` }
  });
  return result.data || { batch_size: 50, max_retries: 3 };
}

// =====================
// Export base URL for configuration
// =====================

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function setApiBaseUrl(url: string) {
  API_BASE_URL = url.trim().replace(/\/+$/, '');
}