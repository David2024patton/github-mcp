// PUB-1: PRIVATE, unexposed tenant isolation foundation. No request route may call this
// until PUB-2 binds a verified GitHub numeric subject to the session. Existing owner
// data in the legacy (public) schema is never migrated, copied or modified here.
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { createDb, SCHEMA_TABLES } from '../db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCHEMA = /^gh_t_[0-9a-f]{32}$/;
const GITHUB_SUBJECT = /^[1-9][0-9]{0,18}$/;
const ROLES = new Set(['owner', 'admin', 'member']);

function validUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('A trusted opaque identity ID is required.');
  return value.toLowerCase();
}
export function tenantSchemaName(tenantId) {
  return 'gh_t_' + validUuid(tenantId).replaceAll('-', '');
}

/** Never include public in the search path: if the tenant schema is missing,
 * unqualified legacy table queries must fail, not silently fall back. The
 * Postgres options parameter is connection-scoped, never a pooled SET call. */
export function tenantConnectionString(connectionString, tenantId) {
  const schema = tenantSchemaName(tenantId);
  if (!SCHEMA.test(schema)) throw new TypeError('Invalid tenant namespace.');
  if (typeof connectionString !== 'string' || !connectionString) throw new TypeError('No tenant database is configured.');
  let url;
  try { url = new URL(connectionString); } catch { throw new TypeError('Invalid tenant database configuration.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      url.searchParams.has('options') || url.searchParams.has('search_path') ||
      url.searchParams.has('service') || url.searchParams.has('sslpassword')) {
    throw new TypeError('Tenant DB URL requires a direct, unmodified PostgreSQL connection configuration.');
  }
  // Neon HTTP supports PostgreSQL's options=-c search_path=... connection parameter.
  // An absent namespace makes current_schema() null, and is always refused below.
  url.searchParams.set('options', '-c search_path=' + schema);
  return url.toString();
}

/** A connection must prove the exact tenant namespace before *any* read or
 * initSchema. This also catches a driver or proxy that ignored URL options. */
export async function assertTenantSearchPath(sql, tenantId) {
  const schema = tenantSchemaName(tenantId);
  const rows = await sql`SELECT current_schema() AS active_schema, current_setting('search_path') AS configured_path`;
  if (rows.length !== 1 || rows[0].active_schema !== schema ||
      rows[0].configured_path !== schema) {
    throw new Error('Tenant database namespace unavailable. No account data was accessed.');
  }
  return schema;
}

/**
 * A private registry with a trusted-provisioning interface. It is intentionally
 * NOT a public login API and never trusts a GitHub login or ChatGPT email as identity.
 * Stable numeric GitHub subject must be verified by PUB-2 *before* invoking enroll.
 */
export function createTenantDirectory(sql) {
  if (typeof sql !== 'function') throw new TypeError('Tenant directory requires a parameterized SQL adapter.');
  return {
    async initSchema() {
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_identities (
        id UUID PRIMARY KEY, provider TEXT NOT NULL CHECK (provider = 'github'),
        provider_subject TEXT NOT NULL CHECK (provider_subject ~ '^[1-9][0-9]{0,18}$'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_subject)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_tenants (
        id UUID PRIMARY KEY, namespace TEXT NOT NULL UNIQUE
          CHECK (namespace ~ '^gh_t_[0-9a-f]{32}$'),
        status TEXT NOT NULL DEFAULT 'provisioning'
          CHECK (status IN ('provisioning','active','suspended')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_memberships (
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
        active BOOLEAN NOT NULL DEFAULT TRUE, revision BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, identity_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS gh_tenant_memberships_identity
        ON gh_tenant_memberships (identity_id, active)`;
      // This function only accepts server-generated opaque namespaces. Unlike
      // concatenating raw SQL in JS, %I quotes the identifier within PostgreSQL.
      // It is SECURITY INVOKER (no privilege elevation) and has no public HTTP route.
      await sql`CREATE OR REPLACE FUNCTION gh_provision_tenant_namespace(namespace_text TEXT)
        RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $body$
        BEGIN
          IF namespace_text !~ '^gh_t_[0-9a-f]{32}$' THEN
            RAISE EXCEPTION 'Invalid tenant namespace';
          END IF;
          EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', namespace_text);
        END $body$`;
    },

    /** Called only after a real provider lookup has established this numeric user ID. */
    async enrollVerifiedGithubSubject(subject) {
      if (typeof subject !== 'string' || !GITHUB_SUBJECT.test(subject))
        throw new TypeError('A verified numeric GitHub subject is required.');
      const id = randomUUID();
      const rows = await sql`INSERT INTO gh_tenant_identities (id,provider,provider_subject)
        VALUES (${id}::uuid,'github',${subject})
        ON CONFLICT (provider,provider_subject) DO UPDATE
          SET provider_subject = EXCLUDED.provider_subject
        RETURNING id`;
      return rows[0].id;
    },

    /** Provisioning never enables an external sign-in: the tenant begins closed. */
    async provision(ownerIdentityId) {
      const owner = validUuid(ownerIdentityId);
      const id = randomUUID();
      const namespace = tenantSchemaName(id);
      const rows = await sql`INSERT INTO gh_tenants (id,namespace,status)
        SELECT ${id}::uuid,${namespace},'provisioning'
        WHERE EXISTS (SELECT 1 FROM gh_tenant_identities WHERE id = ${owner}::uuid)
        RETURNING id,namespace,status`;
      if (!rows.length) throw new Error('Verified owner identity is not enrolled.');
      await sql`INSERT INTO gh_tenant_memberships (tenant_id,identity_id,role)
        VALUES (${id}::uuid,${owner}::uuid,'owner')`;
      // If schema creation fails, tenant remains non-active and unusable.
      await sql`SELECT gh_provision_tenant_namespace(${namespace})`;
      return { id: String(rows[0].id), namespace, status: 'provisioning' };
    },

    /** Caller must initialize and verify ALL existing tables in the isolated
     * namespace before the row can be made active. */
    async activate(tenantId, namespaceVerified) {
      const id = validUuid(tenantId);
      if (namespaceVerified !== tenantSchemaName(id)) return false;
      // Never trust a caller-supplied namespace string as an initialization proof.
      // The provisioning role independently verifies all known table families first.
      const present = await sql`SELECT count(*)::integer AS table_count FROM pg_catalog.pg_tables
        WHERE schemaname = ${namespaceVerified} AND tablename = ANY(${SCHEMA_TABLES}::text[])`;
      if (present.length !== 1 || Number(present[0].table_count) !== SCHEMA_TABLES.length) return false;
      const rows = await sql`UPDATE gh_tenants SET status = 'active'
        WHERE id = ${id}::uuid AND namespace = ${namespaceVerified}
          AND status = 'provisioning' RETURNING id`;
      return rows.length === 1;
    },

    /** No global account listing exists here; a nonmember, suspended tenant, or
     * revoked user gets the same absence result. Caller identity is provider-bound
     * in PUB-2. Check on every scoped session creation (no cached privileges). */
    async authorized(tenantId, identityId) {
      const t = validUuid(tenantId), i = validUuid(identityId);
      const rows = await sql`SELECT t.id, t.namespace, m.role, m.revision
        FROM gh_tenants t JOIN gh_tenant_memberships m ON m.tenant_id = t.id
        WHERE t.id = ${t}::uuid AND m.identity_id = ${i}::uuid
          AND t.status = 'active' AND m.active = TRUE`;
      return rows.length === 1 ? { tenantId: String(rows[0].id),
        namespace: rows[0].namespace, role: rows[0].role,
        membershipRevision: Number(rows[0].revision) } : null;
    },

    /** Membership widening is owner-controlled: no public self-grant. */
    async grant(tenantId, actorIdentityId, targetIdentityId, role) {
      const t = validUuid(tenantId), actor = validUuid(actorIdentityId), target = validUuid(targetIdentityId);
      if (!ROLES.has(role) || role === 'owner') throw new TypeError('Only member/admin grants are supported.');
      const rows = await sql`INSERT INTO gh_tenant_memberships (tenant_id,identity_id,role)
        SELECT ${t}::uuid,${target}::uuid,${role}
        WHERE EXISTS (SELECT 1 FROM gh_tenant_memberships own
          JOIN gh_tenants ten ON ten.id = own.tenant_id
          WHERE own.tenant_id = ${t}::uuid AND own.identity_id = ${actor}::uuid
            AND own.role = 'owner' AND own.active = TRUE AND ten.status = 'active')
          AND EXISTS (SELECT 1 FROM gh_tenant_identities WHERE id = ${target}::uuid)
        ON CONFLICT (tenant_id,identity_id) DO UPDATE SET role = EXCLUDED.role,
          active = TRUE, revision = gh_tenant_memberships.revision + 1, updated_at = now()
        WHERE gh_tenant_memberships.role <> 'owner'
        RETURNING identity_id,revision`;
      return rows.length === 1;
    },

    async revoke(tenantId, actorIdentityId, targetIdentityId) {
      const t = validUuid(tenantId), actor = validUuid(actorIdentityId), target = validUuid(targetIdentityId);
      const rows = await sql`UPDATE gh_tenant_memberships m
        SET active = FALSE, revision = revision + 1, updated_at = now()
        WHERE m.tenant_id = ${t}::uuid AND m.identity_id = ${target}::uuid
          AND m.active = TRUE AND m.role <> 'owner'
          AND EXISTS (SELECT 1 FROM gh_tenant_memberships own
            WHERE own.tenant_id = ${t}::uuid AND own.identity_id = ${actor}::uuid
              AND own.role = 'owner' AND own.active = TRUE)
        RETURNING m.identity_id`;
      return rows.length === 1;
    }
  };
}

/** Never takes tenant from an HTTP parameter or cookie. PUB-2 must first verify
 * identity with GitHub and resolve membership through the service-owned registry.
 * Private tests may inject an isolated SQL factory; production uses Neon URL
 * options. Both must pass the exact current_schema and search_path assertions. */
export async function openAuthorizedTenantDb({ directory, tenantId, verifiedIdentityId,
  connectionString = process.env.DATABASE_URL, sqlFactory = neon }) {
  if (!directory || typeof directory.authorized !== 'function')
    throw new TypeError('A private tenant directory is required.');
  const bound = await directory.authorized(tenantId, verifiedIdentityId);
  if (!bound || bound.namespace !== tenantSchemaName(tenantId))
    throw new Error('Tenant membership is not authorized.');
  const sql = sqlFactory(tenantConnectionString(connectionString, tenantId));
  await assertTenantSearchPath(sql, tenantId);
  return { tenant: Object.freeze(bound), db: createDb(sql), sql };
}

/** For a newly provisioned, inactive tenant only. The caller is trusted internal
 * code; never expose this to an MCP tool, arbitrary OAuth client or public URL. */
export async function initializeProvisionedTenant({ tenantId, connectionString = process.env.DATABASE_URL,
  sqlFactory = neon }) {
  const sql = sqlFactory(tenantConnectionString(connectionString, tenantId));
  const namespace = await assertTenantSearchPath(sql, tenantId);
  const db = createDb(sql);
  await db.initSchema();
  if (JSON.stringify(await db.listTables()) !== JSON.stringify([...SCHEMA_TABLES].sort()))
    throw new Error('Tenant schema is not fully initialized. No tenant was activated.');
  return { namespace, db };
}
