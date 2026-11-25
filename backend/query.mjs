export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

const TABLE_COLUMNS = {
  campaigns: new Set([
    'id',
    'name',
    'template_id',
    'connection_id',
    'status',
    'total_recipients',
    'sent_count',
    'failed_count',
    'user_id',
    'created_at',
    'updated_at',
  ]),
  gateway_connections: new Set([
    'id',
    'endpoint_url',
    'sender_name',
    'api_key',
    'user_id',
    'created_at',
    'updated_at',
  ]),
  gateway_settings: new Set([
    'id',
    'user_id',
    'batch_size',
    'max_retries',
    'default_connection_id',
    'updated_at',
  ]),
  message_templates: new Set([
    'id',
    'title',
    'body',
    'variable_mappings',
    'user_id',
    'created_at',
    'updated_at',
  ]),
};

function quoteColumn(column, columns) {
  if (!columns.has(column)) throw new Error(`Unsupported database column: ${column}`);
  return `"${column}"`;
}

function getProjection(value, columns) {
  if (!value || value === '*') return '*';
  return value.split(',').map((column) => quoteColumn(column.trim(), columns)).join(', ');
}

function getFilters(searchParams, columns, values) {
  const filters = [];
  for (const [column, expression] of searchParams) {
    if (['select', 'order', 'on_conflict', 'limit', 'offset'].includes(column)) continue;
    const quotedColumn = quoteColumn(column, columns);
    const separator = expression.indexOf('.');
    if (separator < 1) throw new Error(`Unsupported filter for ${column}`);
    const operator = expression.slice(0, separator);
    const value = expression.slice(separator + 1);
    if (operator === 'eq') {
      values.push(value);
      filters.push(`${quotedColumn} = $${values.length}`);
    } else if (operator === 'is' && value === 'null') {
      filters.push(`${quotedColumn} IS NULL`);
    } else {
      throw new Error(`Unsupported filter operator: ${operator}`);
    }
  }
  return filters;
}

function getOrder(searchParams, columns) {
  const order = searchParams.get('order');
  if (!order) return '';
  return ` ORDER BY ${order.split(',').map((item) => {
    const [column, direction = 'asc'] = item.split('.');
    if (!['asc', 'desc'].includes(direction)) throw new Error('Unsupported sort direction');
    return `${quoteColumn(column, columns)} ${direction.toUpperCase()}`;
  }).join(', ')}`;
}

function getReturning(searchParams, columns, prefer) {
  if (!prefer.includes('return=representation')) return '';
  return ` RETURNING ${getProjection(searchParams.get('select'), columns)}`;
}

function addLocalOwnerFilter(table, filters, values) {
  if (!TABLE_COLUMNS[table].has('user_id')) return;
  values.push(LOCAL_USER_ID);
  filters.push(`"user_id" = $${values.length}`);
}

function normalizeRows(body, columns) {
  const rows = Array.isArray(body) ? body : [body];
  if (rows.length === 0 || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Expected a non-empty object or array of objects');
  }
  const keys = Object.keys(rows[0]);
  if (keys.length === 0) throw new Error('Expected at least one database column');
  for (const key of keys) quoteColumn(key, columns);
  for (const row of rows) {
    if (Object.keys(row).sort().join(',') !== [...keys].sort().join(',')) {
      throw new Error('All rows in a batch must contain the same columns');
    }
    if (row.user_id !== undefined && row.user_id !== LOCAL_USER_ID) {
      throw new Error('The local API can only write the local user row');
    }
  }
  return rows.map((row) => ({ ...row, ...(columns.has('user_id') ? { user_id: LOCAL_USER_ID } : {}) }));
}

export function buildPostgrestQuery({ table, method, searchParams, body, prefer = '' }) {
  const columns = TABLE_COLUMNS[table];
  if (!columns) throw new Error(`Unsupported database table: ${table}`);

  if (method === 'GET') {
    const values = [];
    const filters = getFilters(searchParams, columns, values);
    addLocalOwnerFilter(table, filters, values);
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    return {
      text: `SELECT ${getProjection(searchParams.get('select'), columns)} FROM "public"."${table}"${where}${getOrder(searchParams, columns)}`,
      values,
      returnsRows: true,
    };
  }

  if (method === 'POST') {
    const rows = normalizeRows(body, columns);
    const rowColumns = Object.keys(rows[0]);
    const values = [];
    const tuples = rows.map((row) => `(${rowColumns.map((column) => {
      values.push(row[column]);
      return `$${values.length}`;
    }).join(', ')})`);
    let conflict = '';
    const conflictColumn = searchParams.get('on_conflict');
    if (prefer.includes('resolution=merge-duplicates')) {
      const target = conflictColumn ?? 'id';
      quoteColumn(target, columns);
      const changedColumns = rowColumns.filter((column) => column !== target && column !== 'user_id');
      const ownerGuard = columns.has('user_id')
        ? ` WHERE "${table}"."user_id" = '${LOCAL_USER_ID}'`
        : '';
      conflict = changedColumns.length
        ? ` ON CONFLICT (${quoteColumn(target, columns)}) DO UPDATE SET ${changedColumns
            .map((column) => `${quoteColumn(column, columns)} = EXCLUDED.${quoteColumn(column, columns)}`)
            .join(', ')}${ownerGuard}`
        : ` ON CONFLICT (${quoteColumn(target, columns)}) DO NOTHING`;
    }
    return {
      text: `INSERT INTO "public"."${table}" (${rowColumns.map((column) => quoteColumn(column, columns)).join(', ')}) VALUES ${tuples.join(', ')}${conflict}${getReturning(searchParams, columns, prefer)}`,
      values,
      returnsRows: prefer.includes('return=representation'),
    };
  }

  if (method === 'PATCH' || method === 'DELETE') {
    const values = [];
    const filters = getFilters(searchParams, columns, values);
    if (filters.length === 0) throw new Error(`${method} requires at least one filter`);
    addLocalOwnerFilter(table, filters, values);
    const where = ` WHERE ${filters.join(' AND ')}`;
    if (method === 'DELETE') {
      return {
        text: `DELETE FROM "public"."${table}"${where}${getReturning(searchParams, columns, prefer)}`,
        values,
        returnsRows: prefer.includes('return=representation'),
      };
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Expected an object for update');
    }
    if (body.user_id !== undefined && body.user_id !== LOCAL_USER_ID) {
      throw new Error('The local API can only write the local user row');
    }
    const updates = Object.entries(body).filter(([column]) => column !== 'user_id');
    if (updates.length === 0) throw new Error('Expected at least one column to update');
    const assignments = updates.map(([column, value]) => {
      values.push(value);
      return `${quoteColumn(column, columns)} = $${values.length}`;
    });
    return {
      text: `UPDATE "public"."${table}" SET ${assignments.join(', ')}${where}${getReturning(searchParams, columns, prefer)}`,
      values,
      returnsRows: prefer.includes('return=representation'),
    };
  }

  throw new Error(`Unsupported database method: ${method}`);
}
