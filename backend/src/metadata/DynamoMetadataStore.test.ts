import { describe, it, expect, vi, afterEach } from 'vitest';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoMetadataStore } from './DynamoMetadataStore';

/**
 * DynamoDB rejects an UpdateExpression that uses a reserved word as a bare
 * attribute name, and only at runtime (ValidationException) — nothing catches
 * it at build time. This asserts the whole family aliases reserved names
 * instead of re-checking one attribute.
 *
 * Subset of the reserved-word list relevant to this table's attributes:
 * https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html
 */
const RESERVED = new Set(['STATUS', 'DURATION', 'NAME', 'SIZE', 'TIMESTAMP', 'VALUE', 'SOURCE', 'YEAR']);

const UPDATES: [string, (s: DynamoMetadataStore) => Promise<unknown>][] = [
  ['updateTitle', (s) => s.updateTitle('v1', 'a title')],
  ['updateStatus', (s) => s.updateStatus('v1', 'ready')],
  ['updateThumbnail', (s) => s.updateThumbnail('v1', true)],
  ['updateConverterJobId', (s) => s.updateConverterJobId('v1', 'job-1')],
  ['updateDuration', (s) => s.updateDuration('v1', 123)],
];

function store(): DynamoMetadataStore {
  return new DynamoMetadataStore({ tableName: 'videos', awsRegion: 'ap-northeast-1' });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('DynamoMetadataStore update expressions', () => {
  it.each(UPDATES)('%s does not use a reserved word as a bare attribute name', async (_name, run) => {
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockResolvedValue({} as never);

    await run(store());

    const { UpdateExpression, ExpressionAttributeNames } = (send.mock.calls[0][0] as any).input;
    const bareNames = [...String(UpdateExpression).matchAll(/(?:SET|,)\s*([#\w]+)\s*=/g)]
      .map((m) => m[1])
      .filter((n) => !n.startsWith('#'));

    expect(bareNames.filter((n) => RESERVED.has(n.toUpperCase()))).toEqual([]);
    // Anything aliased must actually resolve, or the write fails just as hard.
    for (const alias of String(UpdateExpression).match(/#\w+/g) ?? []) {
      expect(ExpressionAttributeNames?.[alias]).toBeDefined();
    }
  });

  it('writes duration under its real attribute name', async () => {
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockResolvedValue({} as never);

    await store().updateDuration('v1', 942);

    const { ExpressionAttributeNames, ExpressionAttributeValues } =
      (send.mock.calls[0][0] as any).input;
    // An alias pointing at a misspelled attribute passes the check above and
    // still loses the write, so pin the target name — not the alias token.
    expect(Object.values(ExpressionAttributeNames ?? {})).toEqual(['duration']);
    expect(Object.values(ExpressionAttributeValues)).toEqual([942]);
  });
});
