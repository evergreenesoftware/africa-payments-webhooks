# Duplicate events

Providers retry deliveries (Paystack for 72 hours), and networks duplicate requests. Pass a `store`:

```ts
interface IdempotencyStore {
  claim(id: string, ttlSeconds: number): boolean | Promise<boolean>; // true = first time we see it
  release?(id: string): void | Promise<void>;                        // called if onEvent throws
}
```

**Redis**
```ts
const store = {
  claim: async (id, ttl) => (await redis.set(`wh:${id}`, '1', 'EX', ttl, 'NX')) === 'OK',
  release: async (id) => void (await redis.del(`wh:${id}`)),
};
```

**Postgres**
```sql
CREATE TABLE webhook_events (id text PRIMARY KEY, seen_at timestamptz NOT NULL DEFAULT now());
```
```ts
const store = {
  claim: async (id) => (await sql`INSERT INTO webhook_events (id) VALUES (${id}) ON CONFLICT DO NOTHING RETURNING id`).length > 0,
  release: async (id) => void (await sql`DELETE FROM webhook_events WHERE id = ${id}`),
};
```

`event.id` is `provider:providerEventType:providerReference[:status]`, so a *status change* (e.g. Flutterwave
`pending → successful`) is processed, but a retry of the same status is not. `MemoryIdempotencyStore` is for
development only. **Also make your fulfilment idempotent** (e.g. "mark order paid if not already paid").
