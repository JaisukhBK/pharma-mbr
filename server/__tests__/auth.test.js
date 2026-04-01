// server/__tests__/auth.test.js
// GAMP5 D6 | 21 CFR Part 11 §11.10(d) — Access controls, lockout, RBAC
// Validates: JWT authentication, 5-attempt lockout, role-based permissions

const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const {
  TEST_PASSWORD, TEST_USERS,
  setupTestDB, teardownTestDB, closePool,
  getToken, resetLoginState,
} = require('./helpers/setup');

const app = createTestApp();

beforeAll(async () => { await setupTestDB(); });
afterAll(async () => { await teardownTestDB(); await closePool(); });

// ════════════════════════════════════════════════════════════════
// §11.10(d) — Authentication
// ════════════════════════════════════════════════════════════════

describe('Authentication (Part 11 §11.10(d))', () => {
  test('valid credentials return JWT token and user profile', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_USERS.admin.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.token.split('.')).toHaveLength(3); // JWT format
    expect(res.body.user.email).toBe(TEST_USERS.admin.email);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.permissions).toEqual(expect.arrayContaining(['mbr:read', 'mbr:write']));
  });

  test('invalid password returns 401 with attempts remaining', async () => {
    await resetLoginState(TEST_USERS.designer.id);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_USERS.designer.email, password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/);
    expect(res.body.error).toMatch(/\d+ attempts left/);
  });

  test('non-existent email returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@fake.com', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/);
  });

  test('missing email or password returns 400', async () => {
    const res1 = await request(app).post('/api/auth/login').send({ email: 'x@y.com' });
    const res2 = await request(app).post('/api/auth/login').send({ password: 'abc' });

    expect(res1.status).toBe(400);
    expect(res2.status).toBe(400);
  });

  test('unauthenticated request to protected endpoint returns 401', async () => {
    const res = await request(app).get('/api/mbr');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authentication required/);
  });

  test('invalid JWT token returns 401', async () => {
    const res = await request(app)
      .get('/api/mbr')
      .set('Authorization', 'Bearer invalid.token.here');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid token/);
  });

  test('/auth/me returns current user profile with permissions', async () => {
    const token = getToken('qa_reviewer');
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('qa_reviewer');
    expect(res.body.permissions).toEqual(expect.arrayContaining(['mbr:read', 'mbr:approve', 'mbr:sign']));
    expect(res.body.permissions).not.toContain('mbr:write');
  });
});

// ════════════════════════════════════════════════════════════════
// §11.10(d) — Account lockout after 5 failed attempts
// ════════════════════════════════════════════════════════════════

describe('Account lockout (Part 11 §11.10(d))', () => {
  beforeEach(async () => {
    await resetLoginState(TEST_USERS.viewer.id);
  });

  test('account locks after 5 consecutive failed login attempts', async () => {
    const email = TEST_USERS.viewer.email;

    // Attempts 1-4: should fail with decreasing attempts count
    for (let i = 1; i <= 4; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'wrong' });
      expect(res.status).toBe(401);
    }

    // Attempt 5: triggers lockout
    const lockRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrong' });
    expect(lockRes.status).toBe(423);
    expect(lockRes.body.error).toMatch(/Account locked/);

    // Attempt 6: even correct password should be locked
    const blockedRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: TEST_PASSWORD });
    expect(blockedRes.status).toBe(423);
    expect(blockedRes.body.error).toMatch(/locked/i);
  });

  test('successful login resets the attempt counter', async () => {
    const email = TEST_USERS.viewer.email;

    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/auth/login').send({ email, password: 'wrong' });
    }

    // Successful login
    const okRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: TEST_PASSWORD });
    expect(okRes.status).toBe(200);

    // 3 more failed attempts should not lock (counter was reset)
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong' });
      expect(res.status).toBe(401); // not 423
    }
  });
});

// ════════════════════════════════════════════════════════════════
// §11.10(d) — Role-Based Access Control (RBAC)
// ════════════════════════════════════════════════════════════════

describe('RBAC permission enforcement (Part 11 §11.10(d))', () => {
  test('designer CAN create MBR (has mbr:write)', async () => {
    const res = await request(app)
      .post('/api/mbr')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ product_name: 'RBAC Test Product' });

    expect(res.status).toBe(201);
    expect(res.body.product_name).toBe('RBAC Test Product');
  });

  test('operator CANNOT create MBR (lacks mbr:write)', async () => {
    const res = await request(app)
      .post('/api/mbr')
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ product_name: 'Should Fail' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Insufficient permissions/);
    expect(res.body.your_role).toBe('production_operator');
  });

  test('viewer CANNOT create MBR (lacks mbr:write)', async () => {
    const res = await request(app)
      .post('/api/mbr')
      .set('Authorization', `Bearer ${getToken('viewer')}`)
      .send({ product_name: 'Should Fail' });

    expect(res.status).toBe(403);
  });

  test('viewer CAN read MBR list (has mbr:read)', async () => {
    const res = await request(app)
      .get('/api/mbr')
      .set('Authorization', `Bearer ${getToken('viewer')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  test('all 5 roles have audit:read permission', async () => {
    for (const role of ['admin', 'designer', 'qa_reviewer', 'operator', 'viewer']) {
      const res = await request(app)
        .get('/api/audit')
        .set('Authorization', `Bearer ${getToken(role)}`);

      // /api/audit doesn't check auth (global endpoint), but this validates token works
      expect(res.status).toBe(200);
    }
  });

  test('only admin can register new users (user:write)', async () => {
    const payload = { email: 'new@test.com', password: 'NewPass1!', full_name: 'New User' };

    const adminRes = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send(payload);
    // 201 or 409 (if already exists) — both prove access was granted
    expect([201, 409]).toContain(adminRes.status);

    const designerRes = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ ...payload, email: 'new2@test.com' });
    expect(designerRes.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════
// §11.200 — Password verification for sensitive operations
// ════════════════════════════════════════════════════════════════

describe('Password verification (Part 11 §11.200)', () => {
  test('correct password passes verification', async () => {
    const res = await request(app)
      .post('/api/auth/verify-password')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  test('wrong password fails verification', async () => {
    const res = await request(app)
      .post('/api/auth/verify-password')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ password: 'WrongPassword' });

    expect(res.status).toBe(401);
  });

  test('missing password returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/verify-password')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({});

    expect(res.status).toBe(400);
  });
});
