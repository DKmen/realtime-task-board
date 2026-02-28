import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task, TStatus } from '../types';
import { TaskCard } from './TaskCard';

interface ColumnProps {
  id: TStatus;
  label: string;
  color: string;
  tasks: Task[];
  currentUserId: string;
  activeTaskId: string | null;
}

export const Column = ({ id, label, color, tasks, currentUserId, activeTaskId }: ColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  const isDraggingOver = isOver;

  return (
    <div
      className={`column${isDraggingOver ? ' column--over' : ''}`}
      style={{ '--col-color': color } as React.CSSProperties}
    >
      <div className="column__header">
        <div className="column__header-left">
          <span className="column__dot" />
          <h2 className="column__title">{label}</h2>
        </div>
        <span className="column__count">{tasks.length}</span>
      </div>

      <div className="column__body" ref={setNodeRef}>
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              currentUserId={currentUserId}
              isBeingDragged={task.id === activeTaskId}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className={`column__empty${isDraggingOver ? ' column__empty--active' : ''}`}>
            <span className="column__empty-icon">+</span>
            <span>{isDraggingOver ? 'Release to drop' : 'No tasks yet'}</span>
          </div>
        )}
      </div>
    </div>
  );
};
