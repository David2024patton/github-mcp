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
      // PUB-2 closed PRIVATE pilot. This registry never grants tenant access by
      // itself: live, active membership AND an owner-issued pilot allowlist entry
      // are required. There is deliberately no public enrollment endpoint.
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_pilot_bootstraps (
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        account_login TEXT NOT NULL CHECK (
          account_login = lower(account_login) AND
          account_login ~ '^[a-z0-9][a-z0-9-]{0,38}$'),
        tenant_id UUID NOT NULL UNIQUE REFERENCES gh_tenants(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (identity_id, account_login)
      )`;
      await sql`CREATE OR REPLACE FUNCTION gh_bootstrap_private_pilot(
        principal_id UUID, account_name TEXT, proposed_id UUID
      ) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER AS $body$
      DECLARE existing_id UUID;
      DECLARE schema_name TEXT;
      BEGIN
        IF account_name !~ '^[a-z0-9][a-z0-9-]{0,38}$'
          OR account_name <> lower(account_name) THEN
          RAISE EXCEPTION 'Invalid private pilot account';
        END IF;
        PERFORM id FROM gh_tenant_identities WHERE id = principal_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Private pilot identity absent'; END IF;
        SELECT tenant_id INTO existing_id FROM gh_tenant_pilot_bootstraps
          WHERE identity_id=principal_id AND account_login=account_name;
        IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;
        schema_name := 'gh_t_' || replace(proposed_id::text, '-', '');
        INSERT INTO gh_tenants (id,namespace,status)
          VALUES (proposed_id,schema_name,'provisioning');
        INSERT INTO gh_tenant_memberships (tenant_id,identity_id,role)
          VALUES (proposed_id,principal_id,'owner');
        INSERT INTO gh_tenant_pilot_bootstraps (identity_id,account_login,tenant_id)
          VALUES (principal_id,account_name,proposed_id);
        PERFORM gh_provision_tenant_namespace(schema_name);
        RETURN proposed_id;
      END $body$`;
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_pilot_allowlist (
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, identity_id)
      )`;
      // GitHub redirect state lives in the private registry only long enough
      // to finish one GitHub authorization. Store a hash of the browser secret.
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_oauth_flows (
        state_hash TEXT PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        client_state TEXT,
        code_challenge TEXT NOT NULL,
        account_login TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('preview','production')),
        profile TEXT NOT NULL CHECK (profile IN ('read_only','everyday','full')),
        listing TEXT NOT NULL CHECK (listing IN ('compact','catalog')),
        provider_verifier TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
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
    /** Only an authenticated owner flow that just verified GitHub may call
     * this. One transaction serializes duplicate taps for the same owner. */
    async provisionPilotForOwnerAccount(identityId, accountLogin) {
      const id=validUuid(identityId);
      if(typeof accountLogin!=='string' ||
          !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin))
        throw new TypeError('Invalid private pilot account name.');
      const proposed=randomUUID();
      const rows=await sql`SELECT gh_bootstrap_private_pilot(
        ${id}::uuid,${accountLogin},${proposed}::uuid) AS tenant_id`;
      if(rows.length!==1 || !rows[0].tenant_id)
        throw new Error('Private pilot creation is unavailable.');
      return String(rows[0].tenant_id);
    },

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

    /** Private owner-only test allowlisting; never enough without live membership
     * and a verified GitHub numeric subject. It cannot create a membership. */
    async allowlistPilotIdentity(tenantId, ownerIdentityId, targetIdentityId) {
      const t = validUuid(tenantId), owner = validUuid(ownerIdentityId), target = validUuid(targetIdentityId);
      const rows = await sql`INSERT INTO gh_tenant_pilot_allowlist (tenant_id,identity_id,active)
        SELECT ${t}::uuid,${target}::uuid,TRUE
        WHERE EXISTS (SELECT 1 FROM gh_tenant_memberships m
          JOIN gh_tenants ten ON ten.id=m.tenant_id
          WHERE m.tenant_id=${t}::uuid AND m.identity_id=${owner}::uuid
            AND m.role='owner' AND m.active=TRUE AND ten.status='active')
          AND EXISTS (SELECT 1 FROM gh_tenant_memberships target
            WHERE target.tenant_id=${t}::uuid AND target.identity_id=${target}::uuid
              AND target.active=TRUE)
        ON CONFLICT (tenant_id,identity_id) DO UPDATE SET active=TRUE,
          revision=gh_tenant_pilot_allowlist.revision+1,updated_at=now()
        RETURNING identity_id`;
      return rows.length === 1;
    },

    /** Owner can shut off a pilot session. No other tenant or ordinary member
     * can revoke someone else's pilot authorization. */
    async revokePilotIdentity(tenantId, ownerIdentityId, targetIdentityId) {
      const t = validUuid(tenantId), owner = validUuid(ownerIdentityId), target = validUuid(targetIdentityId);
      const rows = await sql`UPDATE gh_tenant_pilot_allowlist p
        SET active=FALSE, revision=p.revision+1, updated_at=now()
        WHERE p.tenant_id=${t}::uuid AND p.identity_id=${target}::uuid AND p.active=TRUE
          AND EXISTS (SELECT 1 FROM gh_tenant_memberships m
            WHERE m.tenant_id=${t}::uuid AND m.identity_id=${owner}::uuid
              AND m.role='owner' AND m.active=TRUE)
        RETURNING p.identity_id`;
      return rows.length === 1;
    },

    /** Called ONLY AFTER independent GET /user verification; caller input
     * alone is not proof. No unapproved member, disabled pilot identity,
     * provisioning tenant or global legacy fallback can appear here. */
    async resolveAllowlistedPilotSubject(tenantId, verifiedSubject) {
      const t = validUuid(tenantId);
      if (typeof verifiedSubject !== 'string' || !GITHUB_SUBJECT.test(verifiedSubject))
        throw new TypeError('Verified numeric GitHub subject required.');
      const rows = await sql`SELECT i.id AS identity_id, t.id AS tenant_id,
          t.namespace,m.role,m.revision AS membership_revision,p.revision AS pilot_revision
        FROM gh_tenant_identities i
        JOIN gh_tenant_memberships m ON m.identity_id=i.id
        JOIN gh_tenants t ON t.id=m.tenant_id
        JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=t.id AND p.identity_id=i.id
        WHERE i.provider='github' AND i.provider_subject=${verifiedSubject}
          AND t.id=${t}::uuid AND t.status='active'
          AND m.active=TRUE AND p.active=TRUE`;
      if (rows.length !== 1) return null;
      const row=rows[0];
      return Object.freeze({ identityId: String(row.identity_id), tenantId: String(row.tenant_id),
        namespace: row.namespace, role: row.role,
        membershipRevision: Number(row.membership_revision), pilotRevision: Number(row.pilot_revision) });
    },

    /** Resolve a previously provider-verified identity from a SERVER-SIGNED token
     * on every request, not from a caller-supplied tenant ID. Both membership
     * and private pilot allowlist must be live. Revocation takes effect at once. */
    async authorizedPilotIdentity(tenantId, identityId) {
      const t = validUuid(tenantId), i = validUuid(identityId);
      const rows = await sql`SELECT t.id,t.namespace,m.role,m.revision AS membership_revision,
          p.revision AS pilot_revision
        FROM gh_tenants t
        JOIN gh_tenant_memberships m ON m.tenant_id=t.id
        JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=t.id AND p.identity_id=m.identity_id
        WHERE t.id=${t}::uuid AND m.identity_id=${i}::uuid
          AND t.status='active' AND m.active=TRUE AND p.active=TRUE`;
      if (rows.length !== 1) return null;
      const v = rows[0];
      return Object.freeze({ tenantId: String(v.id), identityId: i,
        namespace: v.namespace, role: v.role,
        membershipRevision: Number(v.membership_revision),
        pilotRevision: Number(v.pilot_revision) });
    },

    /** One-use GitHub callback state; all OAuth settings are saved by the
     * server during a gated request rather than trusted from callback query. */
    async createPilotOAuthFlow({ stateHash, tenantId, identityId, clientId,
      redirectUri, clientState, codeChallenge, accountLogin, mode, profile,
      listing, providerVerifier }) {
      const t=validUuid(tenantId), i=validUuid(identityId);
      if (!/^[a-f0-9]{64}$/.test(stateHash) || typeof clientId!=='string' ||
          clientId.length<32 || typeof redirectUri!=='string' ||
          typeof providerVerifier!=='string' || providerVerifier.length<43 ||
          !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
          typeof accountLogin!=='string' ||
          !['preview','production'].includes(mode) ||
          !['read_only','everyday','full'].includes(profile) ||
          !['compact','catalog'].includes(listing) ||
          (clientState!==null && (typeof clientState!=='string' || clientState.length>256)))
        throw new TypeError('Invalid private pilot GitHub authorization state.');
      const rows=await sql`INSERT INTO gh_tenant_oauth_flows (
        state_hash,tenant_id,identity_id,client_id,redirect_uri,client_state,
        code_challenge,account_login,mode,profile,listing,provider_verifier,expires_at)
        SELECT ${stateHash},${t}::uuid,${i}::uuid,${clientId},${redirectUri},
          ${clientState},${codeChallenge},${accountLogin},${mode},${profile},
          ${listing},${providerVerifier},now()+interval '10 minutes'
        WHERE EXISTS (SELECT 1 FROM gh_tenant_memberships m
          JOIN gh_tenants t ON t.id=m.tenant_id
          JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=m.tenant_id AND p.identity_id=m.identity_id
          WHERE m.tenant_id=${t}::uuid AND m.identity_id=${i}::uuid
            AND m.active=TRUE AND p.active=TRUE AND t.status='active')
        RETURNING state_hash`;
      return rows.length===1;
    },

    async consumePilotOAuthFlow(stateHash) {
      if (typeof stateHash!=='string' || !/^[a-f0-9]{64}$/.test(stateHash)) return null;
      const rows=await sql`DELETE FROM gh_tenant_oauth_flows f
        WHERE f.state_hash=${stateHash} AND f.expires_at>now()
        RETURNING tenant_id,identity_id,client_id,redirect_uri,client_state,
          code_challenge,account_login,mode,profile,listing,provider_verifier`;
      const row=rows[0];
      return row ? { tenantId:String(row.tenant_id),identityId:String(row.identity_id),
        clientId:row.client_id,redirectUri:row.redirect_uri,clientState:row.client_state,
        codeChallenge:row.code_challenge,accountLogin:row.account_login,
        mode:row.mode,profile:row.profile,listing:row.listing,
        providerVerifier:row.provider_verifier } : null;
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
