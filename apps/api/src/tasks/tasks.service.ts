import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, Types } from 'mongoose';
import type { Paginated, TaskActivityEntry, TaskDetail, TaskSummary } from '@projectflow/shared';
import { toUserSummary } from '../common/utils/serialize';
import { Comment, type CommentDocument } from '../comments/schemas/comment.schema';
import { canManage, canView, ProjectAccessService } from '../projects/project-access.service';
import { Project, type ProjectDocument } from '../projects/schemas/project.schema';
import { UsersService } from '../users/users.service';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { ListTasksQueryDto } from './dto/list-tasks.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import type { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { Task, type TaskDocument } from './schemas/task.schema';
import { TASK_ASSIGNEE_CHANGED } from '@projectflow/shared';
import { TaskActivity, type TaskActivityDocument } from './schemas/task-activity.schema';
import type { PaginationQueryDto } from '../common/dto/pagination.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(TaskActivity.name) private readonly activityModel: Model<TaskActivityDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    private readonly projectAccessService: ProjectAccessService,
    private readonly usersService: UsersService,
  ) {}

  async findActivity(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    query: PaginationQueryDto,
  ): Promise<Paginated<TaskActivityEntry>> {
    const task = await this.findTaskOrFail(taskId);
    await this.projectAccessService.assertCanView(task.projectId, userId);

    const [records, total] = await Promise.all([
      this.activityModel
        .find({ taskId })
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.pageSize)
        .exec(),
      this.activityModel.countDocuments({ taskId }),
    ]);

    return {
      items: await this.toActivityEntries(records),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async toActivityEntries(records: TaskActivityDocument[]): Promise<TaskActivityEntry[]> {
    if (records.length === 0) {
      return [];
    }

    const userIds = records.flatMap((record) => {
      const ids: Types.ObjectId[] = [record.actorId];
      if (record.from) {
        ids.push(record.from);
      }
      if (record.to) {
        ids.push(record.to);
      }
      return ids;
    });
    const users = await this.usersService.findManyByIds(userIds);
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));

    return records.map((record) => ({
      id: record._id.toString(),
      taskId: record.taskId.toString(),
      type: TASK_ASSIGNEE_CHANGED,
      actor: toCreatorSummary(usersById.get(record.actorId.toString())),
      from: record.from ? toCreatorSummary(usersById.get(record.from.toString())) : null,
      to: record.to ? toCreatorSummary(usersById.get(record.to.toString())) : null,
      createdAt: record.createdAt.toISOString(),
    }));
  }

  async findByProject(
    projectId: Types.ObjectId,
    userId: Types.ObjectId,
    query: ListTasksQueryDto,
  ): Promise<Paginated<TaskSummary>> {
    await this.projectAccessService.assertCanView(projectId, userId);

    const filter: FilterQuery<TaskDocument> = { projectId };
    if (query.status) {
      filter.status = query.status;
    }
    if (query.priority) {
      filter.priority = query.priority;
    }

    const [tasks, total] = await Promise.all([
      this.taskModel.find(filter).sort({ number: 1 }).skip(query.skip).limit(query.pageSize).exec(),
      this.taskModel.countDocuments(filter),
    ]);

    return {
      items: await this.toSummaries(tasks),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(
    projectId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: CreateTaskDto,
  ): Promise<TaskDetail> {
    const { project } = await this.projectAccessService.assertCanView(projectId, userId);

    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await this.taskModel
        .findOne({ projectId })
        .sort({ number: -1 })
        .select('number')
        .exec();
      const number = (last?.number ?? 0) + 1;

      try {
        const task = await this.taskModel.create({
          projectId,
          number,
          key: `${project.key}-${number}`,
          title: dto.title,
          description: dto.description ?? null,
          status: dto.status,
          priority: dto.priority,
          createdBy: userId,
        });

        return this.toDetail(task, project);
      } catch (error) {
        if (attempt < 4 && isDuplicateKeyError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new BadRequestException('Could not create task, please try again');
  }

  async findOne(taskId: Types.ObjectId, userId: Types.ObjectId): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const { project } = await this.projectAccessService.assertCanView(task.projectId, userId);

    return this.toDetail(task, project);
  }

  async update(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: UpdateTaskDto,
  ): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const access = await this.projectAccessService.assertCanView(task.projectId, userId);

    const isCreator = task.createdBy.equals(userId);
    if (!canManage(access) && !isCreator) {
      throw new ForbiddenException('You do not have permission to edit this task');
    }

    if (dto.title !== undefined) {
      task.title = dto.title;
    }
    if (dto.description !== undefined) {
      task.description = dto.description;
    }
    if (dto.status !== undefined) {
      task.status = dto.status;
    }
    if (dto.priority !== undefined) {
      task.priority = dto.priority;
    }

    await task.save();

    return this.toDetail(task, access.project);
  }

  async assignTask(
    taskId: Types.ObjectId,
    actorId: Types.ObjectId,
    assigneeId: string | null,
  ): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const access = await this.projectAccessService.assertCanView(task.projectId, actorId);

    const targetId = assigneeId ? new Types.ObjectId(assigneeId) : null;
    const currentId = task.assignee ?? null;

    if (!canManage(access)) {
      if (targetId === null) {
        if (!currentId?.equals(actorId)) {
          throw new ForbiddenException('You do not have permission to unassign this task');
        }
      } else if (!targetId.equals(actorId)) {
        throw new ForbiddenException(
          'You do not have permission to assign this task to someone else',
        );
      }
    }

    if (targetId) {
      await this.usersService.findByIdOrFail(targetId);
      const targetAccess = await this.projectAccessService.resolve(task.projectId, targetId);
      if (!canView(targetAccess)) {
        throw new BadRequestException('User is not a member of this project');
      }
    }

    if (
      (currentId === null && targetId === null) ||
      (currentId !== null && targetId !== null && currentId.equals(targetId))
    ) {
      return this.toDetail(task, access.project);
    }

    task.assignee = targetId;
    await task.save();

    await this.activityModel.create({
      taskId: task._id,
      projectId: task.projectId,
      type: TASK_ASSIGNEE_CHANGED,
      actorId,
      from: currentId,
      to: targetId,
    });

    return this.toDetail(task, access.project);
  }

  async updateStatus(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: UpdateTaskStatusDto,
  ): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const access = await this.projectAccessService.assertCanView(task.projectId, userId);

    const isCreator = task.createdBy.equals(userId);
    if (!canManage(access) && !isCreator) {
      throw new ForbiddenException('You do not have permission to edit this task');
    }

    task.status = dto.status;
    await task.save();

    return this.toDetail(task, access.project);
  }

  async remove(taskId: Types.ObjectId, userId: Types.ObjectId): Promise<void> {
    const task = await this.findTaskOrFail(taskId);
    await this.projectAccessService.assertCanManage(task.projectId, userId);

    await Promise.all([this.commentModel.deleteMany({ taskId: task._id }), task.deleteOne()]);
  }

  async findTaskOrFail(taskId: Types.ObjectId): Promise<TaskDocument> {
    const task = await this.taskModel.findById(taskId).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  private async toSummaries(tasks: TaskDocument[]): Promise<TaskSummary[]> {
    if (tasks.length === 0) {
      return [];
    }

    const [users, commentRows] = await Promise.all([
      this.usersService.findManyByIds(
        tasks.flatMap((task) =>
          task.assignee ? [task.createdBy, task.assignee] : [task.createdBy],
        ),
      ),
      this.commentModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
        }>([
          { $match: { taskId: { $in: tasks.map((task) => task._id) } } },
          { $group: { _id: '$taskId', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);

    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    const commentCounts = new Map(commentRows.map((row) => [row._id.toString(), row.count]));

    return tasks.map((task) => ({
      id: task._id.toString(),
      projectId: task.projectId.toString(),
      number: task.number,
      key: task.key,
      title: task.title,
      status: task.status,
      priority: task.priority,
      commentCount: commentCounts.get(task._id.toString()) ?? 0,
      createdBy: toCreatorSummary(usersById.get(task.createdBy.toString())),
      assignee: task.assignee ? toCreatorSummary(usersById.get(task.assignee.toString())) : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }));
  }

  private async toDetail(task: TaskDocument, project?: ProjectDocument): Promise<TaskDetail> {
    const [summary] = await this.toSummaries([task]);
    const resolvedProject = project ?? (await this.projectModel.findById(task.projectId).exec());

    if (!resolvedProject) {
      throw new NotFoundException('Project not found');
    }

    return {
      ...summary!,
      description: task.description ?? null,
      project: {
        id: resolvedProject._id.toString(),
        name: resolvedProject.name,
        key: resolvedProject.key,
      },
    };
  }
}

const DELETED_USER = {
  id: '',
  name: 'Unknown user',
  email: '',
  avatarUrl: null,
};

function toCreatorSummary(user: Parameters<typeof toUserSummary>[0] | undefined) {
  return user ? toUserSummary(user) : DELETED_USER;
}
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 11000
  );
}
