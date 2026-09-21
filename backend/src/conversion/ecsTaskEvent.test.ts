import { describe, it, expect } from 'vitest';
import { parseEcsTaskEvent, type EcsTaskStateChangeDetail } from './ecsTaskEvent';

function detail(overrides: Partial<EcsTaskStateChangeDetail> = {}): EcsTaskStateChangeDetail {
  return {
    lastStatus: 'STOPPED',
    containers: [{ name: 'converter', exitCode: 0 }],
    overrides: {
      containerOverrides: [{
        name: 'converter',
        environment: [{ name: 'VIDEO_ID', value: 'v1' }],
      }],
    },
    ...overrides,
  };
}

describe('parseEcsTaskEvent', () => {
  it('is not a crash when the task has not stopped yet', () => {
    const result = parseEcsTaskEvent(detail({ lastStatus: 'RUNNING', containers: [{ name: 'converter', exitCode: undefined }] }));
    expect(result.crashed).toBe(false);
  });

  it('is not a crash when every container exits 0', () => {
    const result = parseEcsTaskEvent(detail({ containers: [{ name: 'converter', exitCode: 0 }] }));
    expect(result.crashed).toBe(false);
    expect(result.videoId).toBe('v1');
  });

  it('is a crash when a container exits non-zero', () => {
    const result = parseEcsTaskEvent(detail({ containers: [{ name: 'converter', exitCode: 1 }] }));
    expect(result.crashed).toBe(true);
  });

  it('is a crash when exitCode is undefined (OOM/SIGKILL leaves no exit code)', () => {
    const result = parseEcsTaskEvent(detail({ containers: [{ name: 'converter', exitCode: undefined }] }));
    expect(result.crashed).toBe(true);
  });

  it('is a crash when there are no containers at all', () => {
    const result = parseEcsTaskEvent(detail({ containers: [] }));
    expect(result.crashed).toBe(true);
  });

  it('leaves videoId undefined when the VIDEO_ID override is missing', () => {
    const result = parseEcsTaskEvent(detail({ overrides: { containerOverrides: [{ name: 'converter', environment: [] }] } }));
    expect(result.videoId).toBeUndefined();
  });
});
