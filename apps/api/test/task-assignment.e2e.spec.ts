import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import {
  OrganizationRole,
  ProjectRole,
  TASK_ASSIGNEE_CHANGED,
  TaskStatus,
} from '@projectflow/shared';
import { createTestApp, resetDatabase } from './utils/test-app';
import {
  addOrganizationMember,
  addProjectMember,
  authHeader,
  createOrganization,
  createProject,
  createTask,
  registerUser,
  type TestUser,
} from './utils/fixtures';

describe('Task assignment and activity', () => {
  let app: INestApplication;
  let connection: Connection;

  let owner: TestUser;
  let manager: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    ({ app, connection } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(connection);

    owner = await registerUser(app, 'Ammar Yaser', 'ammar@example.com');
    manager = await registerUser(app, 'Ahmed Hassan', 'ahmed@example.com');
    member = await registerUser(app, 'Magd Ali', 'magd@example.com');
    outsider = await registerUser(app, 'Outside User', 'outside@example.com');

    const organizationId = await createOrganization(
      connection,
      'Acme Software',
      'acme-software',
      owner.id,
    );
    await addOrganizationMember(connection, organizationId, owner.id, OrganizationRole.OWNER);
    await addOrganizationMember(connection, organizationId, manager.id, OrganizationRole.MEMBER);
    await addOrganizationMember(connection, organizationId, member.id, OrganizationRole.MEMBER);

    projectId = await createProject(
      connection,
      organizationId,
      'Internal Platform',
      'ENG',
      owner.id,
    );
    await addProjectMember(connection, projectId, manager.id, ProjectRole.PROJECT_MANAGER);
    await addProjectMember(connection, projectId, member.id, ProjectRole.MEMBER);

    taskId = await createTask(connection, projectId, 'ENG', 1, 'Assignment target', owner.id);
  });

  it('lets a project member assign the task to themselves', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(member))
      .send({ assigneeId: member.id })
      .expect(200);

    expect(response.body.assignee).toMatchObject({ email: 'magd@example.com' });
  });

  it('lets a project manager assign another project member', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: member.id })
      .expect(200);

    expect(response.body.assignee).toMatchObject({ email: 'magd@example.com' });
  });

  it('refuses when a regular member assigns someone else', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(member))
      .send({ assigneeId: manager.id })
      .expect(403);
  });

  it('refuses to assign a user outside the project', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: outsider.id })
      .expect(400);
  });

  it('refuses task activity to users outside the project', async () => {
    await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(outsider))
      .expect(403);
  });

  it('records activity when the assignee changes', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: member.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      type: TASK_ASSIGNEE_CHANGED,
      taskId,
      from: null,
    });
    expect(response.body.items[0].actor).toMatchObject({ email: 'ahmed@example.com' });
    expect(response.body.items[0].to).toMatchObject({ email: 'magd@example.com' });
  });

  it('records activity when the task is unassigned', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: member.id })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: null })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(manager))
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items[0].to).toBeNull();
    expect(response.body.items[0].from).toMatchObject({ email: 'magd@example.com' });
    expect(response.body.items[1].to).toMatchObject({ email: 'magd@example.com' });
  });

  it('refuses status changes from outside the project', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/status`)
      .set('Authorization', authHeader(outsider))
      .send({ status: TaskStatus.IN_PROGRESS })
      .expect(403);
  });

  it('hands out unique numbers under concurrent creation', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        request(app.getHttpServer())
          .post(`/projects/${projectId}/tasks`)
          .set('Authorization', authHeader(member))
          .send({ title: `Concurrent task ${index}` }),
      ),
    );

    for (const response of responses) {
      expect(response.status).toBe(201);
    }

    const numbers = responses
      .map((response) => response.body.number)
      .sort((a: number, b: number) => a - b);
    expect(numbers).toEqual([2, 3, 4, 5, 6]);

    const keys = responses.map((response) => response.body.key);
    expect(new Set(keys).size).toBe(5);
  });
});
