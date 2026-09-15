import { IsMongoId, IsOptional } from 'class-validator';

export class AssignTaskDto {
  @IsOptional()
  @IsMongoId()
  assigneeId?: string | null;
}