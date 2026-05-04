const { pickResumableUpload } = require('./api');

describe('pickResumableUpload — TUS resumption validation', () => {
  it('returns the previous upload when size matches', () => {
    const prev = [{ size: 10000000, url: 'http://example.com/upload/abc' }];
    const result = pickResumableUpload(prev, 10000000);

    expect(result).toBe(prev[0]);
  });

  it('returns null when previous upload size differs (file replaced)', () => {
    const prev = [{ size: 5000000, url: 'http://example.com/upload/abc' }];
    const result = pickResumableUpload(prev, 10000000);

    expect(result).toBeNull();
  });

  it('returns null when no previous uploads exist', () => {
    const result = pickResumableUpload([], 10000000);

    expect(result).toBeNull();
  });

  it('only checks the first previous upload', () => {
    const prev = [
      { size: 5000000, url: 'http://example.com/upload/old' },
      { size: 10000000, url: 'http://example.com/upload/match' },
    ];
    const result = pickResumableUpload(prev, 10000000);

    // First entry doesn't match, so returns null (doesn't check second)
    expect(result).toBeNull();
  });
});
