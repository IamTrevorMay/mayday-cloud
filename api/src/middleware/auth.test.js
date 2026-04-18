import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { SignJWT } from 'jose';
import crypto from 'crypto';

const TEST_SECRET = 'test-jwt-secret-that-is-long-enough-for-hs256';

// ── Helpers ─────────────────────────────────────────────────────────
function makeJwt({ sub, email, role, expiresIn, secret } = {}) {
  const key = new TextEncoder().encode(secret || TEST_SECRET);
  let builder = new SignJWT({ sub, email, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt();
  if (expiresIn !== undefined) {
    builder = builder.setExpirationTime(expiresIn);
  } else {
    builder = builder.setExpirationTime('1h');
  }
  return builder.sign(key);
}

function makeSupabaseChain(overrides = {}) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: vi.fn((cb) => { cb(); return Promise.resolve(); }),
    ...overrides,
  };
  return chain;
}

// ── Tests ───────────────────────────────────────────────────────────
describe('verifyToken', () => {
  let verifyToken;
  let authModule;
  const mockFrom = vi.fn();
  const mockSupabase = { from: mockFrom };

  beforeAll(async () => {
    process.env.SUPABASE_JWT_JWK = TEST_SECRET;
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

    authModule = await import('./auth.js');
    verifyToken = authModule.verifyToken;

    // Inject mock Supabase factory via the test hook
    authModule._supabaseFactory = () => mockSupabase;
  });

  beforeEach(() => {
    mockFrom.mockReset();
  });

  // ── JWT tests ───────────────────────────────────────────────────

  it('throws when no token is provided', async () => {
    await expect(verifyToken(null)).rejects.toThrow('No token');
    await expect(verifyToken(undefined)).rejects.toThrow('No token');
    await expect(verifyToken('')).rejects.toThrow('No token');
  });

  it('verifies a valid HS256 JWT and returns user info', async () => {
    const token = await makeJwt({
      sub: 'user-123',
      email: 'test@test.com',
      role: 'authenticated',
    });

    const result = await verifyToken(token);
    expect(result).toEqual({
      id: 'user-123',
      email: 'test@test.com',
      role: 'authenticated',
    });
  });

  it('throws on an expired JWT', async () => {
    const token = await makeJwt({
      sub: 'user-123',
      email: 'test@test.com',
      role: 'authenticated',
      expiresIn: 0,
    });

    await expect(verifyToken(token)).rejects.toThrow();
  });

  it('throws on an invalid/garbage JWT string', async () => {
    await expect(verifyToken('not.a.valid.jwt')).rejects.toThrow();
  });

  it('throws when JWT is signed with a different secret', async () => {
    const token = await makeJwt({
      sub: 'user-123',
      email: 'test@test.com',
      role: 'authenticated',
      secret: 'completely-different-secret-that-should-not-work',
    });

    await expect(verifyToken(token)).rejects.toThrow();
  });

  // ── API key tests ─────────────────────────────────────────────

  it('returns user info for a valid API key', async () => {
    const testKey = 'mck_testapikey123';

    mockFrom.mockImplementation((table) => {
      if (table === 'api_keys') {
        return makeSupabaseChain({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'key-1',
              user_id: 'user-456',
              scoped_path: '/some/path',
              revoked_at: null,
            },
            error: null,
          }),
        });
      }
      if (table === 'profiles') {
        return makeSupabaseChain({
          single: vi.fn().mockResolvedValue({
            data: { role: 'admin' },
            error: null,
          }),
        });
      }
      // update last_used_at call
      return makeSupabaseChain();
    });

    const result = await verifyToken(testKey);
    expect(result).toEqual({
      id: 'user-456',
      apiKey: true,
      scopedPath: '/some/path',
      role: 'admin',
    });
  });

  it('throws when API key is revoked', async () => {
    const testKey = 'mck_revokedkey';

    mockFrom.mockImplementation((table) => {
      if (table === 'api_keys') {
        return makeSupabaseChain({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'key-2',
              user_id: 'user-789',
              scoped_path: null,
              revoked_at: '2025-01-01T00:00:00Z',
            },
            error: null,
          }),
        });
      }
      return makeSupabaseChain();
    });

    await expect(verifyToken(testKey)).rejects.toThrow('API key revoked');
  });

  it('throws when API key is not found', async () => {
    const testKey = 'mck_unknownkey';

    mockFrom.mockImplementation((table) => {
      if (table === 'api_keys') {
        return makeSupabaseChain({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'not found' },
          }),
        });
      }
      return makeSupabaseChain();
    });

    await expect(verifyToken(testKey)).rejects.toThrow('Invalid API key');
  });
});
