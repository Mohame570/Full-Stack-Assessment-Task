import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';
import { TASK_ASSIGNEE_CHANGED } from '@projectflow/shared';

export type TaskActivityDocument = HydratedDocument<TaskActivity>;

@Schema({ timestamps: true, collection: 'task_activities' })
export class TaskActivity {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  taskId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  projectId: Types.ObjectId;

  @Prop({ type: String, required: true, default: TASK_ASSIGNEE_CHANGED })
  type: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  from?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  to?: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export const TaskActivitySchema = SchemaFactory.createForClass(TaskActivity);

TaskActivitySchema.index({ taskId: 1, createdAt: -1 });
