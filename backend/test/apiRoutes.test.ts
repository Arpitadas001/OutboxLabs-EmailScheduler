/// <reference path="../src/types/session.d.ts" />

import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import express, { Express } from 'express';
import session from 'express-session';
import { createServer } from 'node:http';
import campaignsRouter from '../src/routes/campaigns';
import { createEmailsRouter } from '../src/routes/emails';
import csvRouter from '../src/routes/csv';
import { emailQueue, emailQueueConnection } from '../src/lib/queue';

async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function createTestApp(authenticated = true): Express {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-session-secret-at-least-32-characters',
    resave: false,
    saveUninitialized: true,
  }));
  if (authenticated) {
    app.use((req, _res, next) => {
      req.session.userId = 'test-user';
      next();
    });
  }
  return app;
}

test('campaign API rejects invalid payloads with the documented validation response', async () => {
  const app = createTestApp();
  app.use('/campaigns', campaignsRouter);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '',
        subject: 'Subject',
        body: 'Body',
        emails: ['not-an-email'],
        startAt: 'not-a-datetime',
        delaySeconds: -1,
        hourlyLimit: 0,
      }),
    });
    const body = await response.json() as { error: string; details: unknown };

    assert.equal(response.status, 422);
    assert.equal(body.error, 'Validation failed');
    assert.ok(body.details);
  });
});

test('email API returns the paginated result shape and passes validated query parameters', async () => {
  const app = createTestApp();
  let call: { userId: string; view: string; page: number; limit: number } | undefined;
  app.use('/emails', createEmailsRouter(async (userId, view, page, limit) => {
    call = { userId, view, page, limit };
    return {
      emails: [{
        id: 'email-1',
        recipientEmail: 'person@example.com',
        status: 'SENT',
        campaign: { subject: 'A subject', name: 'A campaign' },
      }],
      total: 1,
      page,
      limit,
      totalPages: 1,
    };
  }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/emails?view=sent&page=2&limit=10`);
    const body = await response.json() as {
      emails: Array<{ recipientEmail: string; campaign: { subject: string } }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(call, { userId: 'test-user', view: 'sent', page: 2, limit: 10 });
    assert.equal(body.emails[0].recipientEmail, 'person@example.com');
    assert.equal(body.emails[0].campaign.subject, 'A subject');
    assert.deepEqual(
      { total: body.total, page: body.page, limit: body.limit, totalPages: body.totalPages },
      { total: 1, page: 2, limit: 10, totalPages: 1 },
    );
  });
});

test('email API rejects invalid view and pagination without invoking the data service', async () => {
  const app = createTestApp();
  let listCalled = false;
  app.use('/emails', createEmailsRouter(async () => {
    listCalled = true;
    return { emails: [], total: 0, page: 1, limit: 50, totalPages: 0 };
  }));

  await withServer(app, async (baseUrl) => {
    const badView = await fetch(`${baseUrl}/emails?view=all`);
    const badPage = await fetch(`${baseUrl}/emails?view=scheduled&page=0`);
    assert.equal(badView.status, 400);
    assert.equal(badPage.status, 400);
    assert.equal(listCalled, false);
  });
});

test('CSV upload endpoint reports valid, invalid, and duplicate lead counts', async () => {
  const app = createTestApp();
  app.use('/csv', csvRouter);

  await withServer(app, async (baseUrl) => {
    const form = new FormData();
    form.set('file', new Blob([
      [
        'email',
        'alpha@example.com',
        'not-an-email',
        'missing@domain',
        'beta@example.com',
        'alpha@example.com',
        'gamma@example.com',
        'delta@example.com',
        'beta@example.com',
      ].join('\n'),
    ], { type: 'text/csv' }), 'mixed.csv');

    const response = await fetch(`${baseUrl}/csv/parse`, { method: 'POST', body: form });
    const body = await response.json() as {
      validCount: number;
      invalidCount: number;
      duplicatesRemoved: number;
      emails: string[];
      invalidRows: string[];
    };

    assert.equal(response.status, 200);
    assert.deepEqual(
      {
        validCount: body.validCount,
        invalidCount: body.invalidCount,
        duplicatesRemoved: body.duplicatesRemoved,
      },
      { validCount: 4, invalidCount: 2, duplicatesRemoved: 2 },
    );
    assert.deepEqual(body.emails, [
      'alpha@example.com',
      'beta@example.com',
      'gamma@example.com',
      'delta@example.com',
    ]);
    assert.equal(body.invalidRows.length, 2);
  });
});

test('protected email and CSV routes reject requests without an authenticated session', async () => {
  const app = createTestApp(false);
  app.use('/emails', createEmailsRouter());
  app.use('/csv', csvRouter);

  await withServer(app, async (baseUrl) => {
    const emails = await fetch(`${baseUrl}/emails?view=scheduled`);
    const form = new FormData();
    form.set('file', new Blob(['email\nperson@example.com'], { type: 'text/csv' }), 'leads.csv');
    const csv = await fetch(`${baseUrl}/csv/parse`, { method: 'POST', body: form });

    assert.equal(emails.status, 401);
    assert.equal(csv.status, 401);
  });
});

test.after(async () => {
  await emailQueue.close();
  await emailQueueConnection.quit();
});
