import { createHash, randomUUID } from 'node:crypto';
import { marketplaceAccount } from './resource.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ready = new WeakMap();
export async function initMarketplaceSchema(sql) {
  if (ready.has(sql)) return ready.get(sql);
  const ddl = async (parts, ...values) => {
    for (let attempt=1; ; attempt++) {
      try { return await sql(parts,...values); }
      catch (error) {
        const concurrent = /tuple concurrently updated/i.test(String(error?.message)) ||
          (error?.code==='23505' && /^pg_(type|class)_/.test(String(error?.constraint)));
        if (!concurrent || attempt>=6) throw error;
        await new Promise(resolve=>setTimeout(resolve,25*attempt));
      }
    }
  };
  const init = (async () => {
    await ddl`CREATE TABLE IF NOT EXISTS gh_marketplace_subscriptions (
      account_id BIGINT PRIMARY KEY, plan_id BIGINT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','cancelled')),
      effective_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await ddl`CREATE TABLE IF NOT EXISTS gh_marketplace_tenants (
      tenant_id UUID PRIMARY KEY REFERENCES gh_tenants(id), account_id BIGINT NOT NULL,
      identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelling')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), cancelled_at TIMESTAMPTZ,
      cleanup_attempt_at TIMESTAMPTZ,
      UNIQUE (account_id,identity_id)
    )`;
    await ddl`ALTER TABLE gh_marketplace_tenants ADD COLUMN IF NOT EXISTS cleanup_attempt_at TIMESTAMPTZ`;
    await ddl`CREATE TABLE IF NOT EXISTS gh_marketplace_deliveries (
      delivery_hash TEXT PRIMARY KEY, body_hash TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await ddl`CREATE TABLE IF NOT EXISTS gh_marketplace_event_watermarks (
      account_hash TEXT PRIMARY KEY, effective_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','cancelled'))
    )`;
    await ddl`CREATE OR REPLACE FUNCTION gh_enroll_marketplace_customer(
      subject TEXT,billing BIGINT,verified_plan BIGINT,verified_at TIMESTAMPTZ,proposed_identity UUID,proposed_tenant UUID
    ) RETURNS TABLE(tenant_id UUID,identity_id UUID) LANGUAGE plpgsql SECURITY INVOKER AS $body$
    DECLARE ident UUID; customer UUID;
    BEGIN
      IF subject !~ '^[1-9][0-9]{0,18}$' OR billing<1 THEN RAISE EXCEPTION 'Invalid customer'; END IF;
      PERFORM 1 FROM gh_marketplace_subscriptions WHERE account_id=billing AND status='active'
        AND plan_id=verified_plan AND effective_at=verified_at FOR UPDATE;
      IF NOT FOUND THEN RETURN; END IF;
      INSERT INTO gh_tenant_identities(id,provider,provider_subject) VALUES(proposed_identity,'github',subject)
        ON CONFLICT(provider,provider_subject) DO UPDATE SET provider_subject=EXCLUDED.provider_subject
        RETURNING id INTO ident;
      customer := gh_bootstrap_private_pilot(ident,'marketplace-'||billing::text,proposed_tenant);
      INSERT INTO gh_marketplace_tenants AS m(tenant_id,account_id,identity_id) VALUES(customer,billing,ident)
        ON CONFLICT ON CONSTRAINT gh_marketplace_tenants_pkey DO UPDATE SET account_id=EXCLUDED.account_id
          WHERE m.status='active';
      IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace cleanup pending'; END IF;
      RETURN QUERY SELECT customer,ident;
    END $body$`;
    await ddl`CREATE TABLE IF NOT EXISTS gh_marketplace_grants (
      tenant_id UUID NOT NULL REFERENCES gh_tenants(id), identity_id UUID NOT NULL,
      account_login TEXT NOT NULL, access_enc TEXT NOT NULL, fingerprint TEXT NOT NULL,
      PRIMARY KEY (tenant_id,fingerprint)
    )`;
    await ddl`CREATE OR REPLACE FUNCTION gh_archive_marketplace_grant() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER AS $body$
      DECLARE channel TEXT;
      BEGIN
        SELECT status INTO channel FROM gh_marketplace_tenants WHERE tenant_id=NEW.tenant_id FOR UPDATE;
        IF FOUND THEN
          IF channel='cancelling' AND (TG_OP='INSERT' OR OLD.refresh_claim_id IS NULL) THEN
            RAISE EXCEPTION 'Marketplace connection cancelled';
          END IF;
          INSERT INTO gh_marketplace_grants(tenant_id,identity_id,account_login,access_enc,fingerprint)
            VALUES (NEW.tenant_id,NEW.identity_id,NEW.account_login,NEW.access_enc,md5(NEW.access_enc))
            ON CONFLICT DO NOTHING;
        END IF;
        RETURN NEW;
      END $body$`;
    await ddl`CREATE OR REPLACE TRIGGER gh_archive_marketplace_grant
      AFTER INSERT OR UPDATE OF access_enc ON gh_tenant_user_authorizations
      FOR EACH ROW EXECUTE FUNCTION gh_archive_marketplace_grant()`;
    await ddl`CREATE OR REPLACE FUNCTION gh_forget_marketplace_tenant(target UUID)
      RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $body$
    DECLARE ns TEXT; ident UUID; billing BIGINT; others INTEGER;
    BEGIN
      SELECT t.namespace,m.identity_id,m.account_id INTO ns,ident,billing
        FROM gh_tenants t JOIN gh_marketplace_tenants m ON m.tenant_id=t.id
        WHERE t.id=target AND m.status='cancelling' FOR UPDATE OF t,m;
      IF NOT FOUND THEN RETURN FALSE; END IF;
      IF ns !~ '^gh_t_[0-9a-f]{32}$' OR NOT EXISTS (
        SELECT 1 FROM gh_tenant_pilot_bootstraps WHERE tenant_id=target
          AND identity_id=ident AND account_login='marketplace-'||billing::text)
        THEN RAISE EXCEPTION 'Not an isolated Marketplace customer'; END IF;
      SELECT count(*) INTO others FROM gh_tenant_memberships WHERE tenant_id=target AND identity_id<>ident;
      IF others>0 THEN RAISE EXCEPTION 'Customer has other members'; END IF;
      DELETE FROM gh_tenant_optional_setup_states WHERE tenant_id=target;
      DELETE FROM gh_tenant_optional_credentials WHERE tenant_id=target;
      DELETE FROM gh_tenant_user_authorizations WHERE tenant_id=target;
      DELETE FROM gh_marketplace_grants WHERE tenant_id=target;
      DELETE FROM gh_tenant_oauth_flows WHERE tenant_id=target;
      DELETE FROM gh_public_flows WHERE tenant_id=target;
      DELETE FROM gh_tenant_pilot_allowlist WHERE tenant_id=target;
      DELETE FROM gh_public_installations WHERE tenant_id=target;
      DELETE FROM gh_public_usage_daily WHERE tenant_id=target;
      DELETE FROM gh_public_usage_hourly WHERE tenant_id=target;
      DELETE FROM gh_tenant_pilot_bootstraps WHERE tenant_id=target;
      DELETE FROM gh_tenant_memberships WHERE tenant_id=target;
      DELETE FROM gh_marketplace_tenants WHERE tenant_id=target;
      DELETE FROM gh_tenants WHERE id=target;
      EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE',ns);
      IF NOT EXISTS (SELECT 1 FROM gh_tenant_memberships WHERE identity_id=ident)
        AND NOT EXISTS (SELECT 1 FROM gh_tenant_pilot_bootstraps WHERE identity_id=ident)
        THEN DELETE FROM gh_tenant_identities WHERE id=ident; END IF;
      DELETE FROM gh_marketplace_subscriptions WHERE account_id=billing AND status='cancelled'
        AND NOT EXISTS (SELECT 1 FROM gh_marketplace_tenants WHERE account_id=billing);
      RETURN TRUE;
    END $body$`;
  })();
  ready.set(sql, init);
  init.catch(() => ready.delete(sql));
  return init;
}

/** All SQL is rooted in the service registry. No HTTP caller supplies a tenant namespace. */
export function createMarketplaceStore(sql) {
  const init = () => initMarketplaceSchema(sql);
  return {
    init,
    async subscription(accountId) {
      await init();
      const rows = await sql`SELECT account_id,plan_id,status,effective_at FROM gh_marketplace_subscriptions
        WHERE account_id=${marketplaceAccount(accountId)}`;
      return rows[0] ?? null;
    },
    async binding(tenantId) {
      if (!UUID.test(String(tenantId))) return null;
      // Existing direct tenants need no Marketplace schema migration to keep working.
      const markers = await sql`SELECT account_login FROM gh_tenant_pilot_bootstraps WHERE tenant_id=${tenantId}::uuid`;
      const marker = markers.find(r => /^marketplace-[1-9][0-9]*$/.test(r.account_login));
      if (!marker) return null;
      const rows = await sql`SELECT m.account_id,m.status,
        (m.status='active' AND s.status='active' AND t.status='active') AS active
        FROM gh_marketplace_tenants m JOIN gh_tenants t ON t.id=m.tenant_id
        LEFT JOIN gh_marketplace_subscriptions s ON s.account_id=m.account_id
        WHERE m.tenant_id=${tenantId}::uuid`;
      return rows[0] ? { accountId: Number(rows[0].account_id), active: rows[0].active === true }
        : { accountId: Number(marker.account_login.slice(12)), active:false };
    },
    /** A signed event's effective date, not arrival order, decides. Cancellation wins a timestamp tie. */
    async event({ accountId, accountHash, planId, status, effectiveAt, deliveryId, raw }) {
      if (!marketplaceAccount(accountId) || !marketplaceAccount(planId) ||
          !['active','cancelled'].includes(status) || !Number.isFinite(new Date(effectiveAt).getTime()) ||
          !/^[a-zA-Z0-9-]{8,100}$/.test(String(deliveryId)) || !/^[a-f0-9]{64}$/.test(String(accountHash)) || !Buffer.isBuffer(raw))
        throw new TypeError('Invalid Marketplace delivery.');
      await init();
      const deliveryHash = createHash('sha256').update(deliveryId).digest('hex');
      const bodyHash = createHash('sha256').update(raw).digest('hex');
      const rows = await sql`WITH receipt AS (
        INSERT INTO gh_marketplace_deliveries(delivery_hash,body_hash) VALUES (${deliveryHash},${bodyHash})
        ON CONFLICT DO NOTHING RETURNING delivery_hash
      ), watermark AS (
        INSERT INTO gh_marketplace_event_watermarks(account_hash,effective_at,status)
        SELECT ${accountHash},${effectiveAt}::timestamptz,${status} WHERE EXISTS (SELECT 1 FROM receipt)
        ON CONFLICT (account_hash) DO UPDATE SET effective_at=EXCLUDED.effective_at,status=EXCLUDED.status
        WHERE gh_marketplace_event_watermarks.effective_at<EXCLUDED.effective_at OR
          (gh_marketplace_event_watermarks.effective_at=EXCLUDED.effective_at AND EXCLUDED.status='cancelled')
        RETURNING account_hash
      ), changed AS (
        INSERT INTO gh_marketplace_subscriptions(account_id,plan_id,status,effective_at)
        SELECT ${accountId},${planId},${status},${effectiveAt}::timestamptz WHERE EXISTS (SELECT 1 FROM watermark)
        ON CONFLICT (account_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,
          effective_at=EXCLUDED.effective_at,updated_at=now()
        WHERE gh_marketplace_subscriptions.effective_at<EXCLUDED.effective_at OR
          (gh_marketplace_subscriptions.effective_at=EXCLUDED.effective_at AND EXCLUDED.status='cancelled')
        RETURNING account_id,status
      ), blocked AS (
        UPDATE gh_marketplace_tenants m SET status='cancelling',cancelled_at=now()
        FROM changed c WHERE c.account_id=m.account_id AND c.status='cancelled' RETURNING m.tenant_id
      ) SELECT (SELECT count(*)::integer FROM changed) AS changed,
        (SELECT count(*)::integer FROM blocked) AS blocked`;
      const receipt = await sql`SELECT body_hash FROM gh_marketplace_deliveries WHERE delivery_hash=${deliveryHash}`;
      if (receipt[0]?.body_hash !== bodyHash) throw new Error('Marketplace delivery collision.');
      await sql`DELETE FROM gh_marketplace_subscriptions WHERE account_id=${accountId} AND status='cancelled'
        AND NOT EXISTS (SELECT 1 FROM gh_marketplace_tenants WHERE account_id=${accountId})`;
      return rows[0];
    },
    /** Subscription lock, identity, namespace and mapping commit together: cancellation cannot strand a new tenant. */
    async enroll({ accountId, subject, planId, effectiveAt }) {
      if (!marketplaceAccount(accountId) || !marketplaceAccount(planId) || !/^[1-9][0-9]{0,18}$/.test(String(subject))) return null;
      await init();
      const rows = await sql`SELECT * FROM gh_enroll_marketplace_customer(${String(subject)},${accountId},${planId},
        ${effectiveAt}::timestamptz,${randomUUID()}::uuid,${randomUUID()}::uuid)`;
      return rows[0] ? {tenantId:String(rows[0].tenant_id),identityId:String(rows[0].identity_id)} : null;
    },
    async pending(limit = 2) {
      await init();
      return await sql`UPDATE gh_marketplace_tenants SET cleanup_attempt_at=now()
        WHERE tenant_id IN (SELECT tenant_id FROM gh_marketplace_tenants WHERE status='cancelling'
          ORDER BY cleanup_attempt_at NULLS FIRST,cancelled_at LIMIT ${Math.min(2, Math.max(1, limit))}
          FOR UPDATE SKIP LOCKED) RETURNING tenant_id,account_id,identity_id,cancelled_at`;
    },
    async grants(tenantId) {
      await init();
      if (!UUID.test(String(tenantId))) throw new TypeError('Invalid customer.');
      // An already-running refresh may finish storing its replacement grant, but must not return it to a cancelled
      // connection. Wait for its lease, with extra headroom beyond Vercel's 60-second maximum request duration.
      const busy = await sql`SELECT 1 FROM gh_tenant_user_authorizations
        WHERE tenant_id=${tenantId}::uuid AND refresh_claim_id IS NOT NULL
          AND refresh_claim_expires_at>now()-interval '5 minutes' LIMIT 1`;
      if (busy.length) throw new Error('Customer refresh is still finishing.');
      return await sql`SELECT a.tenant_id,a.identity_id,a.account_login,a.access_enc
        FROM gh_marketplace_grants a JOIN gh_marketplace_tenants m ON m.tenant_id=a.tenant_id
        WHERE m.tenant_id=${tenantId}::uuid AND m.status='cancelling' LIMIT 2`;
    },
    async revoked(grant) {
      await sql`DELETE FROM gh_marketplace_grants WHERE tenant_id=${grant.tenant_id}::uuid AND access_enc=${grant.access_enc}`;
    },
    async purge(tenantId) {
      await init();
      if (!UUID.test(String(tenantId))) throw new TypeError('Invalid customer.');
      // A single transaction deletes root references AND the isolated schema. Only our marker can be deleted.
      const remaining = await sql`SELECT 1 FROM gh_marketplace_grants WHERE tenant_id=${tenantId}::uuid LIMIT 1`;
      if (remaining.length) return false;
      const rows = await sql`SELECT gh_forget_marketplace_tenant(${tenantId}::uuid) AS removed`;
      return rows[0]?.removed === true;
    }
  };
}
