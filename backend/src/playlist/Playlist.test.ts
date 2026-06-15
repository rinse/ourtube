import { describe, it, expect } from 'vitest';
import { addMember, removeMember, reorderMembers, validatePlaylist } from './Playlist';

describe('addMember', () => {
  it('appends a new id to the end', () => {
    expect(addMember(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op (dedup) when the id is already present', () => {
    expect(addMember(['a', 'b'], 'a')).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const input = ['a'];
    addMember(input, 'b');
    expect(input).toEqual(['a']);
  });
});

describe('removeMember', () => {
  it('removes the id', () => {
    expect(removeMember(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('is a no-op when the id is absent', () => {
    expect(removeMember(['a', 'b'], 'z')).toEqual(['a', 'b']);
  });
});

describe('reorderMembers', () => {
  it('applies a full permutation', () => {
    expect(reorderMembers(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('rejects an unknown id (not a subset)', () => {
    expect(reorderMembers(['a', 'b'], ['a', 'z'])).toBeNull();
  });

  it('rejects duplicates in the desired order', () => {
    expect(reorderMembers(['a', 'b'], ['a', 'a'])).toBeNull();
  });

  it('preserves dangling refs (subset reorder) at the end', () => {
    // 'x' is a dangling ref the UI never saw; reordering the visible [a,b]
    // keeps 'x' rather than dropping it.
    expect(reorderMembers(['a', 'x', 'b'], ['b', 'a'])).toEqual(['b', 'a', 'x']);
  });

  it('accepts an empty desired order (keeps everything as-is at the end)', () => {
    expect(reorderMembers(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});

describe('validatePlaylist', () => {
  it('accepts a well-formed playlist', () => {
    const p = validatePlaylist({
      id: 'p1', name: 'My list', created_at: 'x', updated_at: 'y', videoIds: ['a'],
    });
    expect(p).not.toBeNull();
    expect(p!.videoIds).toEqual(['a']);
  });

  it('rejects a malformed playlist', () => {
    expect(validatePlaylist({ id: 'p1' })).toBeNull();
  });
});
