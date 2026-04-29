import { HindsightClient } from '@vectorize-io/hindsight-client';

const baseUrl = process.env.HINDSIGHT_BASE_URL || 'http://localhost:8888';
const apiKey = process.env.HINDSIGHT_API_KEY;
const bankId = process.env.HINDSIGHT_TEST_BANK_ID || 'hindsight-pi-smoke';

const client = new HindsightClient({
  baseUrl,
  ...(apiKey ? { apiKey } : {}),
});

try {
  try {
    await client.getBankProfile(bankId);
  } catch {
    await client.createBank(bankId, { name: bankId, background: 'Smoke test bank for hindsight-pi' });
  }

  await client.retainBatch(bankId, [{
    content: 'Smoke test memory from hindsight-pi extension scaffold.',
    context: 'manual smoke test',
    metadata: { source: 'hindsight-pi-smoke' },
    tags: ['harness:pi', 'smoke:test'],
    observation_scopes: [['harness:pi']],
    document_id: 'hindsight-pi-smoke-session',
    update_mode: 'append',
    timestamp: new Date().toISOString(),
  }], { async: false });

  const result = await client.recall(bankId, 'smoke test memory', { budget: 'low', maxTokens: 256 });
  console.log(JSON.stringify({ ok: true, baseUrl, bankId, resultCount: result?.results?.length ?? 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, baseUrl, bankId, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
